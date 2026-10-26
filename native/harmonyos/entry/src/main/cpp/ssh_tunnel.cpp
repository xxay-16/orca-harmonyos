// Copyright (c) 2026 OMP Remote contributors. MIT License; see rawfile/licenses/OMP-Remote.txt.
// Orca Remote native SSH transport. All libssh2 operations for a session run on
// one I/O thread; neither network setup nor forwarding blocks the ArkUI thread.
#include <napi/native_api.h>
#include <libssh2.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#include <atomic>
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {
constexpr size_t MAX_BUFFER = 256 * 1024;
constexpr size_t MAX_CHANNELS = 16;
std::once_flag libraryOnce;

std::string base64(const unsigned char *data, size_t length) {
  static const char table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string result;
  for (size_t i = 0; i < length; i += 3) {
    const unsigned value = (unsigned(data[i]) << 16) |
      (i + 1 < length ? unsigned(data[i + 1]) << 8 : 0) | (i + 2 < length ? data[i + 2] : 0);
    result += table[(value >> 18) & 63]; result += table[(value >> 12) & 63];
    if (i + 1 < length) result += table[(value >> 6) & 63];
    if (i + 2 < length) result += table[value & 63];
  }
  return result;
}

void nonblocking(int fd) { fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK); }

int connectTcp(const std::string &host, int port) {
  addrinfo hints{}; hints.ai_socktype = SOCK_STREAM; hints.ai_family = AF_UNSPEC;
  addrinfo *addresses = nullptr;
  if (getaddrinfo(host.c_str(), std::to_string(port).c_str(), &hints, &addresses) != 0)
    throw std::runtime_error("SSH address could not be resolved");
  int result = -1;
  for (auto *address = addresses; address; address = address->ai_next) {
    int fd = socket(address->ai_family, SOCK_STREAM, 0);
    if (fd < 0) continue;
    nonblocking(fd);
    int status = connect(fd, address->ai_addr, address->ai_addrlen);
    if (status < 0 && errno == EINPROGRESS) {
      pollfd pending{fd, POLLOUT, 0};
      status = poll(&pending, 1, 12000) > 0 ? 0 : -1;
      int error = 0; socklen_t size = sizeof(error);
      if (status == 0 && (getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) != 0 || error)) status = -1;
    }
    if (status == 0) { result = fd; break; }
    close(fd);
  }
  freeaddrinfo(addresses);
  if (result < 0) throw std::runtime_error("Cannot reach the SSH server");
  fcntl(result, F_SETFL, fcntl(result, F_GETFL, 0) & ~O_NONBLOCK);
  timeval timeout{15, 0};
  setsockopt(result, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  setsockopt(result, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
  return result;
}

struct Channel {
  int fd = -1;
  LIBSSH2_CHANNEL *remote = nullptr;
  std::string outgoing, incoming;
  bool localEof = false, eofSent = false, remoteEof = false, dead = false;
};

class Tunnel {
public:
  int fd = -1, listener = -1, localPort = 0, remotePort = 6768;
  std::string fingerprint;
  LIBSSH2_SESSION *session = nullptr;
  std::atomic<bool> running{false};
  std::thread worker;

  ~Tunnel() {
    stop();
    if (fd >= 0) { shutdown(fd, SHUT_RDWR); close(fd); fd = -1; }
    if (session) {
      libssh2_session_set_blocking(session, 1);
      libssh2_session_set_timeout(session, 1000);
      libssh2_session_free(session);
    }
    if (listener >= 0) close(listener);
  }

  void stop() {
    running = false;
    if (worker.joinable()) worker.join();
  }

  void handshake(const std::string &host, int port) {
    std::call_once(libraryOnce, [] {
      if (libssh2_init(0) != 0) throw std::runtime_error("SSH crypto initialization failed");
    });
    fd = connectTcp(host, port);
    session = libssh2_session_init();
    if (!session) throw std::runtime_error("Unable to create an SSH session");
    libssh2_session_set_blocking(session, 1);
    libssh2_session_set_timeout(session, 15000);
    libssh2_session_method_pref(session, LIBSSH2_METHOD_HOSTKEY,
      "rsa-sha2-512,rsa-sha2-256,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,ecdsa-sha2-nistp521");
    if (libssh2_session_handshake(session, fd) != 0)
      throw std::runtime_error("SSH handshake failed; check the host and port");
    const auto *hash = reinterpret_cast<const unsigned char *>(libssh2_hostkey_hash(session, LIBSSH2_HOSTKEY_HASH_SHA256));
    if (!hash) throw std::runtime_error("SSH host key is unavailable");
    fingerprint = "SHA256:" + base64(hash, 32);
  }

  void open(const std::string &host, int port, const std::string &username,
            const std::string &auth, const std::string &key, const std::string &password,
            const std::string &passphrase, const std::string &expected, int targetPort) {
    if (expected.empty()) throw std::runtime_error("SSH_HOSTKEY_REQUIRED");
    handshake(host, port);
    // Verify the pinned server key BEFORE sending a password or proving possession of a private key.
    if (fingerprint != expected) throw std::runtime_error("SSH_HOSTKEY_MISMATCH");
    int authenticated = -1;
    if (auth == "password") {
      authenticated = libssh2_userauth_password_ex(session, username.c_str(), username.size(),
        password.c_str(), password.size(), nullptr);
    } else if (auth == "key") {
      authenticated = libssh2_userauth_publickey_frommemory(session, username.c_str(), username.size(), nullptr, 0,
        key.c_str(), key.size(), passphrase.empty() ? nullptr : passphrase.c_str());
    }
    if (authenticated != 0) throw std::runtime_error("SSH_AUTH_FAILED");
    remotePort = targetPort;
    listener = socket(AF_INET, SOCK_STREAM, 0);
    if (listener < 0) throw std::runtime_error("Cannot create the local SSH tunnel");
    int yes = 1; setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
    sockaddr_in address{}; address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(listener, reinterpret_cast<sockaddr *>(&address), sizeof(address)) != 0 || listen(listener, 8) != 0)
      throw std::runtime_error("Cannot bind the local SSH tunnel");
    socklen_t length = sizeof(address);
    getsockname(listener, reinterpret_cast<sockaddr *>(&address), &length);
    localPort = ntohs(address.sin_port);
    nonblocking(listener); nonblocking(fd);
    libssh2_session_set_blocking(session, 0);
    libssh2_keepalive_config(session, 1, 15);
    running = true;
    worker = std::thread([this] { forward(); });
  }

private:
  void forward() {
    std::vector<Channel> channels;
    char buffer[16384];
    auto keepaliveAt = std::chrono::steady_clock::now();
    while (running) {
      if (std::chrono::steady_clock::now() >= keepaliveAt) {
        int seconds = 15;
        const int result = libssh2_keepalive_send(session, &seconds);
        if (result < 0 && result != LIBSSH2_ERROR_EAGAIN) break;
        keepaliveAt = std::chrono::steady_clock::now() + std::chrono::seconds(result == LIBSSH2_ERROR_EAGAIN ? 1 : std::max(1, seconds));
      }
      std::vector<pollfd> polls{{listener, POLLIN, 0}, {fd, POLLIN, 0}};
      bool needWrite = false;
      for (auto &channel : channels) {
        short events = channel.outgoing.size() < MAX_BUFFER && !channel.localEof ? POLLIN : 0;
        if (!channel.incoming.empty()) events |= POLLOUT;
        polls.push_back({channel.fd, events, 0});
        needWrite = needWrite || !channel.outgoing.empty() || !channel.remote;
      }
      if (needWrite && (libssh2_session_block_directions(session) & LIBSSH2_SESSION_BLOCK_OUTBOUND))
        polls[1].events |= POLLOUT;
      const int events = poll(polls.data(), polls.size(), 50);
      if (events < 0 && errno != EINTR) break;
      if (polls[1].revents & (POLLERR | POLLNVAL | POLLHUP)) break;
      if (polls[0].revents & POLLIN) {
        int client = accept(listener, nullptr, nullptr);
        if (client >= 0) {
          if (channels.size() >= MAX_CHANNELS) close(client);
          else { nonblocking(client); Channel channel; channel.fd = client; channels.push_back(std::move(channel)); }
        }
      }
      bool opening = false;
      for (auto &channel : channels) {
        if (!channel.remote) {
          if (opening) continue;
          channel.remote = libssh2_channel_direct_tcpip_ex(session, "127.0.0.1", remotePort, "127.0.0.1", 0);
          if (!channel.remote) {
            if (libssh2_session_last_errno(session) == LIBSSH2_ERROR_EAGAIN) { opening = true; continue; }
            channel.dead = true; continue;
          }
        }
        if (!channel.localEof && channel.outgoing.size() < MAX_BUFFER) {
          const auto count = recv(channel.fd, buffer, sizeof(buffer), 0);
          if (count > 0) channel.outgoing.append(buffer, size_t(count));
          else if (count == 0) channel.localEof = true;
          else if (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) channel.dead = true;
        }
        if (!channel.outgoing.empty()) {
          const auto count = libssh2_channel_write(channel.remote, channel.outgoing.data(), channel.outgoing.size());
          if (count > 0) channel.outgoing.erase(0, size_t(count));
          else if (count != LIBSSH2_ERROR_EAGAIN && count < 0) channel.dead = true;
        }
        if (channel.localEof && channel.outgoing.empty() && !channel.eofSent) {
          const int status = libssh2_channel_send_eof(channel.remote);
          if (status == 0) channel.eofSent = true;
          else if (status != LIBSSH2_ERROR_EAGAIN) channel.dead = true;
        }
        if (!channel.remoteEof && channel.incoming.size() < MAX_BUFFER) {
          const auto count = libssh2_channel_read(channel.remote, buffer, sizeof(buffer));
          if (count > 0) channel.incoming.append(buffer, size_t(count));
          else if (count != LIBSSH2_ERROR_EAGAIN && count < 0) channel.dead = true;
          if (libssh2_channel_eof(channel.remote)) channel.remoteEof = true;
        }
        if (!channel.incoming.empty()) {
          const auto count = send(channel.fd, channel.incoming.data(), channel.incoming.size(), MSG_NOSIGNAL);
          if (count > 0) channel.incoming.erase(0, size_t(count));
          else if (count < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) channel.dead = true;
        }
        if (channel.remoteEof && channel.incoming.empty()) channel.dead = true;
      }
      for (auto it = channels.begin(); it != channels.end();) {
        if (!it->dead) { ++it; continue; }
        if (it->remote && libssh2_channel_free(it->remote) == LIBSSH2_ERROR_EAGAIN) { ++it; continue; }
        close(it->fd); it = channels.erase(it);
      }
    }
    running = false;
    for (auto &channel : channels) {
      if (channel.remote) libssh2_channel_free(channel.remote);
      close(channel.fd);
    }
    if (listener >= 0) { close(listener); listener = -1; }
  }
};

std::mutex tunnelsMutex;
std::map<int, std::shared_ptr<Tunnel>> tunnels;

std::string stringProperty(napi_env env, napi_value object, const char *name) {
  napi_value value; size_t size = 0;
  if (napi_get_named_property(env, object, name, &value) != napi_ok ||
      napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok)
    throw std::runtime_error(std::string("Missing SSH field: ") + name);
  std::string result(size + 1, '\0');
  napi_get_value_string_utf8(env, value, result.data(), result.size(), &size);
  result.resize(size); return result;
}

int intProperty(napi_env env, napi_value object, const char *name) {
  napi_value value; int32_t result = 0;
  if (napi_get_named_property(env, object, name, &value) != napi_ok ||
      napi_get_value_int32(env, value, &result) != napi_ok || result <= 0 || result > 65535)
    throw std::runtime_error(std::string("Invalid SSH port: ") + name);
  return result;
}

struct OpenWork {
  napi_async_work work{};
  napi_deferred deferred{};
  std::string host, username, auth, key, password, passphrase, fingerprint, error;
  int port = 22, target = 6768;
  bool probe = false;
  std::shared_ptr<Tunnel> tunnel;
};

void wipe(std::string &secret) {
  volatile char *bytes = secret.empty() ? nullptr : &secret[0];
  for (size_t i = 0; i < secret.size(); ++i) bytes[i] = 0;
  secret.clear();
}

void executeOpen(napi_env, void *pointer) {
  auto &data = *static_cast<OpenWork *>(pointer);
  try {
    data.tunnel = std::make_shared<Tunnel>();
    if (data.probe) {
      data.tunnel->handshake(data.host, data.port);
      data.fingerprint = data.tunnel->fingerprint;
      data.tunnel.reset();
    } else {
      data.tunnel->open(data.host, data.port, data.username, data.auth, data.key, data.password,
        data.passphrase, data.fingerprint, data.target);
    }
  } catch (const std::exception &error) { data.error = error.what(); data.tunnel.reset(); }
  wipe(data.key); wipe(data.password); wipe(data.passphrase);
}

void completeOpen(napi_env env, napi_status status, void *pointer) {
  std::unique_ptr<OpenWork> data(static_cast<OpenWork *>(pointer));
  napi_value value;
  if (status == napi_ok && data->error.empty() && data->probe) {
    napi_create_string_utf8(env, data->fingerprint.c_str(), data->fingerprint.size(), &value);
    napi_resolve_deferred(env, data->deferred, value);
  } else if (status == napi_ok && data->error.empty() && data->tunnel) {
    const int port = data->tunnel->localPort;
    { std::lock_guard<std::mutex> guard(tunnelsMutex); tunnels[port] = data->tunnel; }
    napi_create_int32(env, port, &value);
    napi_resolve_deferred(env, data->deferred, value);
  } else {
    napi_value text;
    const auto message = data->error.empty() ? "SSH connection cancelled" : data->error;
    napi_create_string_utf8(env, message.c_str(), message.size(), &text);
    napi_create_error(env, nullptr, text, &value);
    napi_reject_deferred(env, data->deferred, value);
  }
  napi_delete_async_work(env, data->work);
}

napi_value scheduleOpen(napi_env env, napi_callback_info info, bool probe) {
  size_t argc = 1; napi_value arguments[1];
  napi_get_cb_info(env, info, &argc, arguments, nullptr, nullptr);
  if (argc != 1) { napi_throw_type_error(env, nullptr, "SSH options are required"); return nullptr; }
  auto data = std::make_unique<OpenWork>();
  data->probe = probe;
  try {
    data->host = stringProperty(env, arguments[0], "host");
    data->port = intProperty(env, arguments[0], "port");
    if (data->host.empty() || data->host.size() > 253) throw std::runtime_error("Invalid SSH host");
    if (!probe) {
      data->username = stringProperty(env, arguments[0], "username");
      data->auth = stringProperty(env, arguments[0], "auth");
      data->key = stringProperty(env, arguments[0], "privateKey");
      data->password = stringProperty(env, arguments[0], "password");
      data->passphrase = stringProperty(env, arguments[0], "passphrase");
      data->fingerprint = stringProperty(env, arguments[0], "fingerprint");
      data->target = intProperty(env, arguments[0], "remotePort");
      if (data->username.empty() || data->username.size() > 128 || data->fingerprint.size() != 50 ||
          data->key.size() > 65536 || data->password.size() > 4096 || data->passphrase.size() > 4096 ||
          (data->auth != "key" && data->auth != "password")) throw std::runtime_error("Invalid SSH credentials");
    }
  } catch (const std::exception &error) { napi_throw_type_error(env, nullptr, error.what()); return nullptr; }
  napi_value promise, name;
  napi_create_promise(env, &data->deferred, &promise);
  napi_create_string_utf8(env, "orca-ssh-connect", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, executeOpen, completeOpen, data.get(), &data->work);
  napi_queue_async_work(env, data->work);
  data.release(); return promise;
}

napi_value openTunnel(napi_env env, napi_callback_info info) { return scheduleOpen(env, info, false); }
napi_value probeHost(napi_env env, napi_callback_info info) { return scheduleOpen(env, info, true); }

struct CloseWork {
  napi_async_work work{};
  napi_deferred deferred{};
  std::shared_ptr<Tunnel> tunnel;
};

void executeClose(napi_env, void *pointer) {
  auto &data = *static_cast<CloseWork *>(pointer);
  if (data.tunnel) { data.tunnel->stop(); data.tunnel.reset(); }
}

void completeClose(napi_env env, napi_status, void *pointer) {
  std::unique_ptr<CloseWork> data(static_cast<CloseWork *>(pointer));
  napi_value result; napi_get_undefined(env, &result);
  napi_resolve_deferred(env, data->deferred, result);
  napi_delete_async_work(env, data->work);
}

napi_value closeTunnel(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value arguments[1]; int32_t port = 0;
  napi_get_cb_info(env, info, &argc, arguments, nullptr, nullptr);
  if (argc) napi_get_value_int32(env, arguments[0], &port);
  std::shared_ptr<Tunnel> tunnel;
  { std::lock_guard<std::mutex> guard(tunnelsMutex);
    const auto found = tunnels.find(port);
    if (found != tunnels.end()) { tunnel = found->second; tunnels.erase(found); }
  }
  auto data = std::make_unique<CloseWork>(); data->tunnel = std::move(tunnel);
  napi_value promise, name;
  napi_create_promise(env, &data->deferred, &promise);
  napi_create_string_utf8(env, "orca-ssh-close", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, nullptr, name, executeClose, completeClose, data.get(), &data->work);
  napi_queue_async_work(env, data->work);
  data.release(); return promise;
}

napi_value isTunnelAlive(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value arguments[1]; int32_t port = 0;
  napi_get_cb_info(env, info, &argc, arguments, nullptr, nullptr);
  if (argc) napi_get_value_int32(env, arguments[0], &port);
  bool alive = false;
  { std::lock_guard<std::mutex> guard(tunnelsMutex);
    const auto found = tunnels.find(port);
    alive = found != tunnels.end() && found->second->running;
  }
  napi_value result; napi_get_boolean(env, alive, &result); return result;
}

napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
    {"openTunnel", nullptr, openTunnel, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeTunnel", nullptr, closeTunnel, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"probeHost", nullptr, probeHost, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isTunnelAlive", nullptr, isTunnelAlive, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, 4, descriptors); return exports;
}
napi_module module = {1, 0, nullptr, init, "orcassh", nullptr, {0}};
__attribute__((constructor)) void registerModule() { napi_module_register(&module); }
} // namespace
