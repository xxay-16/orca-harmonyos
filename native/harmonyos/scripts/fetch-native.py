"""Fetch pinned SSH dependencies into this project, never a global environment."""
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "third_party"
CACHE = ROOT / ".local" / "downloads"
SSH_COMMIT = "298b8b15ed2c24f34ae2b8c27c5587896d43bfba"
MBED_VERSION = "3.6.7"
SSH_SHA256 = "33af62bf47ccb2291259f65be776961503e8a682c384a0b7ded8549c0dfd7752"
MBED_SHA256 = "a7e8bcbec0e6f761b4af24f25677626b35f762f68eef79c08677a363212d11f6"


def download(url, target):
    if target.exists():
        return
    print("Downloading", url, flush=True)
    with urllib.request.urlopen(url, timeout=90) as response, target.open("wb") as output:
        shutil.copyfileobj(response, output)


def unpack(archive, name):
    target = DEST / name
    if (target / "CMakeLists.txt").exists():
        return
    scratch = DEST / (name + "-extract")
    scratch.mkdir(exist_ok=True, parents=True)
    with tarfile.open(archive) as source:
        source.extractall(scratch, filter="data")
    children = list(scratch.iterdir())
    if len(children) != 1 or not children[0].is_dir():
        raise RuntimeError("Unexpected source archive structure")
    children[0].rename(target)
    scratch.rmdir()


def main():
    DEST.mkdir(exist_ok=True)
    CACHE.mkdir(exist_ok=True, parents=True)
    ssh_archive = CACHE / ("libssh2-" + SSH_COMMIT + ".tar.gz")
    mbed_archive = CACHE / ("mbedtls-" + MBED_VERSION + ".tar.bz2")
    sums = CACHE / ("mbedtls-" + MBED_VERSION + "-sha256sum.txt")
    download(f"https://codeload.github.com/libssh2/libssh2/tar.gz/{SSH_COMMIT}", ssh_archive)
    base = f"https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-{MBED_VERSION}"
    download(base + "/" + mbed_archive.name, mbed_archive)
    download(base + "/" + sums.name, sums)
    expected = next(line.split()[0] for line in sums.read_text().splitlines()
                    if mbed_archive.name in line)
    actual = hashlib.sha256(mbed_archive.read_bytes()).hexdigest()
    if actual != expected or actual != MBED_SHA256:
        raise RuntimeError("Mbed TLS source checksum mismatch")
    if hashlib.sha256(ssh_archive.read_bytes()).hexdigest() != SSH_SHA256:
        raise RuntimeError("libssh2 source checksum mismatch")
    unpack(ssh_archive, "libssh2")
    unpack(mbed_archive, "mbedtls")
    manifest = {"libssh2Commit": SSH_COMMIT, "libssh2ArchiveSha256": hashlib.sha256(ssh_archive.read_bytes()).hexdigest(),
                "mbedtlsVersion": MBED_VERSION, "mbedtlsArchiveSha256": actual}
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    licenses = ROOT / "entry/src/main/resources/rawfile/licenses"
    licenses.mkdir(exist_ok=True, parents=True)
    for component, filename in (("libssh2", "COPYING"), ("mbedtls", "LICENSE")):
        shutil.copyfile(DEST / component / filename, licenses / (component + ".txt"))
    print("Pinned native dependencies ready", flush=True)


if __name__ == "__main__":
    main()
