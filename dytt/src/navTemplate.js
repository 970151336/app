/**
 * navTemplate.js — 导航控制器（Nav Controller）代码生成器
 * ------------------------------------------------------------------
 * 这 4 个文件（homeNav / categoryNav / rankNav / mineNav）90% 的代码完全一样，
 * 差异只有：根页面路径(rootPath)、导航标题(rootTitle)、以及默认标题文字。
 * 这里把「公共的 HTML / CSS / 脚本」抽成模板，把「个性化的东西」通过 cfg 传进去，
 * 用 buildNavController(cfg) 一份函数生成这 4 个文件的代码。
 *
 * 运行方式：
 *   1) 浏览器里：window.NavFactory.buildNavController(cfg)  -> 返回 HTML 字符串
 *   2) Node 里  ：const { buildNavController } = require('./src/navTemplate.js')
 *
 * cfg 字段：
 docTitle: 'appName'
 bsae:  app 根目录（用于 srcdoc 内相对路径解析：./src/... 与 ./pages/...）
 *   rootTitle : '首页'                                      （导航栏默认标题，必填）
 *   rootPath  : './pages/home.html'                         （业务根页面路径，必填）
 *   theme     : {                                           （个性化主题，可选，有默认值）
 *       primary   : 主题强调色（返回按钮 / 右侧按钮颜色），默认 '#ff5c38'
 *       navBg     : 导航栏背景色，默认 'rgba(14,14,17,0.86)'
 *       border    : 导航栏底部分隔线颜色，默认 'rgba(255,255,255,0.08)'
 *       titleColor: 标题文字颜色，默认 '#ffffff'
 *       pageBg    : 页面容器（iframe）背景色，默认 '#0e0e11'
 *       font      : 字体，默认 iOS 系统字体
 *   }
 */
(function (root) {
  'use strict';

  // 公共 HTML 骨架：除个性化字段外，与原本 4 个 nav 文件完全一致
  function buildNavController(cfg) {
    if (!cfg || !cfg.rootPath) {
      throw new Error('buildNavController(cfg) 需要 rootPath ');
    }

    const theme = Object.assign({
      primary: '#ff5c38',
      navBg: 'rgba(14, 14, 17, 0.86)',
      border: 'rgba(255, 255, 255, 0.08)',
      titleColor: '#ffffff',
      pageBg: '#0e0e11',
      font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif'
    }, cfg.theme || {});

    const docTitle = cfg.docTitle || '';
    const base = cfg.base || '';
    const rootTitle = JSON.stringify(cfg.rootTitle);
    const rootPath = JSON.stringify(cfg.rootPath);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>${docTitle}</title>
    ${base ? `<base href="${base}">` : ''}
    <style>
        :root {
            --safe-area-inset-top: env(safe-area-inset-top);
            --safe-area-inset-bottom: env(safe-area-inset-bottom);
            --safe-area-inset-left: env(safe-area-inset-left);
            --safe-area-inset-right: env(safe-area-inset-right);
            /* 主题色：与 pages/page.css、index.html 保持一致，换肤只改这几处 */
            --primary: ${theme.primary};
            --nav-bg: ${theme.navBg};
            --border: ${theme.border};
        }
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
        }

        .ios-nav {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 44px;
            padding-top: env(safe-area-inset-top);
            backgroundColor: ${theme.navBg};
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border-bottom: 0.5px solid ${theme.border};
            box-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.3);
            display: flex;
            align-items: center;
            z-index: 999;
            overflow: hidden;
        }

        .nav-title {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            font-size: 17px;
            font-weight: 600;
            width: max-content;
            color: ${theme.titleColor};
            font-family: ${theme.font};
        }

        .back-btn {
            position: absolute;
            left: 9px;
            display: none;
            align-items: center;
            height: 44px;
            padding: 0 8px 0 0;
            background: transparent;
            border: none;
            color: ${theme.primary};
            font-size: 17px;
            font-family: ${theme.font};
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            user-select: none;
            z-index: 1;
        }

        .back-btn::before {
            content: "";
            display: inline-block;
            width: 12px;
            height: 12px;
            border-left: 2.5px solid ${theme.primary};
            border-bottom: 2.5px solid ${theme.primary};
            transform: rotate(45deg);
            box-shadow: -0.5px 0.5px 0 rgba(0, 0, 0, 0.1);
            margin-left: 2.5px;
            display: var(--back-display, inline-block);
        }

        .right-bar {
            position: absolute;
            right: 8px;
            display: flex;
            align-items: center;
            height: 44px;
            background: transparent;
            padding: 0;
            margin: 0;
            border: none;
            color: ${theme.primary};
            font-size: 17px;
            font-family: ${theme.font};
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            user-select: none;
            z-index: 1;
        }
        .barItem:active {
            opacity: 0.7;
        }
        .barItem {
            animation: fadeIn 0.25s ease forwards;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        #page-container {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 99;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
        }
        .page-iframe {
            position: absolute;
            left: 0;
            width: 100%;
            height: 100%;
            border: none;
            transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1),
            opacity 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
            pointer-events: none;
            overflow-x: hidden;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            z-index: 1;
        }
        .page-iframe {
            transform: translateX(100vw);
            opacity: 0;
        }
        .page-iframe.active {
            transform: translateX(0);
            opacity: 1;
            pointer-events: auto;
            z-index: 10;
            box-shadow: -8px 0 15px rgba(0, 0, 0, 0.05);
        }
        .page-iframe.prev-page {
            transform: translateX(-20%);
            opacity: 1;
            z-index: 1;
        }
        .page-iframe.back {
            transform: translateX(100vw);
            opacity: 0.95;
            z-index: 10;
        }
        .page-iframe.initial.active {
            transition: none;
            transform: translateX(0);
            opacity: 1;
            box-shadow: none;
        }
        .page-iframe.initial.prev-page {
            transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.25, 1),
            opacity 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
            transform: translateX(-20%);
            opacity: 1;
        }
    </style>
</head>
<body>
<div class="ios-nav">
    <button class="back-btn barItem" id="backBtn"></button>
    <div class="nav-title" id="navTitle">${cfg.rootTitle}</div>
    <button class="right-bar" id="rightBar"></button>
</div>
<div id="page-container"></div>
<script type="text/javascript" src="./src/MpPageRouter.js"></script>

<script>
    // 初始化页面管理器（${cfg.rootTitle}导航控制器）
    let navRouter;
    window.addEventListener('load', () => {
        navRouter = new MpPageRouter({
            containerId: 'page-container',
            backBtnId: 'backBtn',
            navTitleId: 'navTitle',
            rightBarId: 'rightBar',
            rootPath: ${rootPath},
            rootTitle: ${rootTitle},
            navBar: {
                visible: true,
                backgroundColor: 'var(--nav-bg)',
                opacity: 1,
                blur: 20,
                titleColor: ${JSON.stringify(theme.titleColor)},
                backBtnColor: 'var(--primary)',
                borderVisible: true
            }
        });
    });

    const navTitle = document.getElementById("navTitle");
    navTitle.addEventListener('click',function(){
        receiveNativeMessage({});
    })
    function receiveNativeMessage(body) {
        let win = window.currentWindow();
        try {
            if (win && typeof win.receiveNativeMessage === 'function') {
                win.receiveNativeMessage(body);
            } else {
                console.error('receiveNativeMessage 方法不存在，无法发送原生消息');
            }
        } catch (error) {
            console.error('调用原生消息方法时发生异常：', error);
        }
    }
    function viewDidAppear(message) {
        const currentPage = navRouter.pageStack[navRouter.pageStack.length - 1];
        const currentIframe = currentPage.iframe;
        if (currentIframe) {
            navRouter.sendPageMessage(currentIframe, {
                type: 'onShow',
                data: { isBack: false, timestamp: Date.now() },
                stackLength: navRouter.pageStack.length
            });
        }
    }
    function viewDidDisappear(message) {
        const currentPage = navRouter.pageStack[navRouter.pageStack.length - 1];
        const currentIframe = currentPage.iframe;
        if (currentIframe) {
            navRouter.sendPageMessage(currentIframe, {
                type: 'onHide',
                data: { to: currentPage.path, isBack: false, timestamp: Date.now() }
            });
        }
    }
</script>
</body>
</html>`;
  }

  // 浏览器 / Node 双兼容导出
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildNavController };
  } else {
    root.NavFactory = { buildNavController };
  }
})(typeof window !== 'undefined' ? window : this);
