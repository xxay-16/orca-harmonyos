/*
 * Copyright (c) 2026 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { webview } from '@kit.ArkWeb';
import { RemoteBridge } from '../ssh/RemoteBridge';
import { window } from '@kit.ArkUI';
import BuildProfile from 'BuildProfile';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: RemoteBridge = new RemoteBridge();
  @StorageLink('orcaremote.dark-mode') @Watch('updateSystemBars') private darkMode: boolean = false;

  aboutToAppear(): void {
    this.bridge.activate();
    const context = this.getUIContext().getHostContext();
    if (context !== undefined) this.bridge.setResourceManager(context.resourceManager);
    webview.WebviewController.setWebDebuggingAccess(BuildProfile.DEBUG);
  }
  aboutToDisappear(): void { this.bridge.dispose(); }

  private updateSystemBars(): void {
    const context = this.getUIContext().getHostContext();
    if (context === undefined) return;
    window.getLastWindow(context).then((mainWindow: window.Window) => {
      mainWindow.setWindowSystemBarProperties({
        statusBarColor: this.darkMode ? '#0A0A0A' : '#FFFFFF',
        navigationBarColor: this.darkMode ? '#0A0A0A' : '#FFFFFF',
        statusBarContentColor: this.darkMode ? '#FFFFFF' : '#0A0A0A',
        navigationBarContentColor: this.darkMode ? '#FFFFFF' : '#0A0A0A'
      }).catch(() => {});
    }).catch(() => {});
  }

  build() {
    Stack() {
      // Only the backdrop extends behind system bars; the console keeps its safe area.
      Column() {}
        .width('100%')
        .height('100%')
        .backgroundColor(this.darkMode ? '#0A0A0A' : '#FFFFFF')
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      Web({ src: $rawfile('console/index.html'), controller: this.controller })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.All)
        .zoomAccess(false)
        .backgroundColor(this.darkMode ? '#0A0A0A' : '#FFFFFF')
        .javaScriptProxy({
          object: this.bridge,
          name: 'OrcaNative',
          // Promise-returning methods use the regular proxy list so ArkWeb preserves their results.
          methodList: ['loadHosts', 'saveHosts', 'saveSshHost', 'randomBytes', 'getDefaultHostId', 'setDefaultHostId', 'setColorScheme',
            'openSsh', 'closeSsh', 'probeSsh', 'readBundledResource'],
          controller: this.controller,
          permission: '{"javascriptProxyPermission":{"urlPermissionList":[{"scheme":"resource","host":"rawfile","port":"","path":""}]}}'
        })
        .onOverrideUrlLoading((request: WebResourceRequest): boolean => {
          const url = request.getRequestUrl().toLowerCase();
          return !(url.startsWith('resource://rawfile/console/') || url.startsWith('resource:/rawfile/console/'));
        })
    }
    .height('100%')
    .width('100%')
    .backgroundColor(this.darkMode ? '#0A0A0A' : '#FFFFFF')
  }
}
