'use strict';
const { ipcRenderer, webFrame } = require('electron');
const MenuHandler = require('../handlers/menu');
const ShareMenu = require('./share_menu');
const MentionMenu = require('./mention_menu');
const BadgeCount = require('./badge_count');
const CtrlServer = require('./ctrl_server');
const Common = require('../common');


class Injector {
  init() {
    Injector.lock(window, 'console', window.console);

    this.initInjectBundle();
    this.initAngularInjection();
    webFrame.setZoomLevelLimits(1, 1);

    this.ctrlServer = new CtrlServer();
    window.ctrlServer = this.ctrlServer;

    new MenuHandler().create();
  }

  initAngularInjection() {
    const self = this;
    const angular = window.angular = {};
    let angularBootstrapReal;
    Object.defineProperty(angular, 'bootstrap', {
      get: () => angularBootstrapReal ? function (element, moduleNames) {
        const moduleName = 'webwxApp';
        if (moduleNames.indexOf(moduleName) < 0) return;
        let constants = null;
        let $injector = angular.injector(['ng', 'Services'])
        $injector.invoke(['confFactory', (confFactory) => (constants = confFactory)]);
        angular.module(moduleName).config(['$httpProvider', ($httpProvider) => {
          $httpProvider.defaults.transformResponse.push((value) => {
            return self.transformResponse(value, constants);
          });
        },
        ]).run(['$rootScope', ($rootScope) => {
          ipcRenderer.send('wx-rendered', MMCgi.isLogin);

          $rootScope.$on('newLoginPage', () => {
            ipcRenderer.send('user-logged', '');
          });
          $rootScope.shareMenu = ShareMenu.inject;
          $rootScope.mentionMenu = MentionMenu.inject;
        }]);

        let ret = angularBootstrapReal.apply(angular, arguments);

        let injector = angular.element(document).injector();
        let accountFactory = window.accountFactory = injector.get('accountFactory')
        let chatFactory = window.chatFactory = injector.get('chatFactory')
        let chatroomFactory = window.chatroomFactory = injector.get('chatroomFactory')
        let confFactory = window.confFactory = injector.get('confFactory')
        let contactFactory = window.contactFactory = injector.get('contactFactory')
        let emojiFactory = window.emojiFactory = injector.get('emojiFactory')
        let utilFactory = window.utilFactory = injector.get('utilFactory')
        let editArea = window.editArea = angular.element('#editArea').scope()

        let chatFactoryMessageProcessReal = chatFactory.messageProcess;
        Object.defineProperty(chatFactory, "messageProcess", {
          get: () => function (e) {
            console.log("hook chatFactory.messageProcess", e);
            // return chatFactoryMessageProcess.apply(chatFactory, arguments)
            return CtrlServer.chatFactoryMessageProcess(chatFactoryMessageProcessReal, chatFactory).apply(chatFactory, arguments)
          },
          set: (d) => {}
        });

        let chatFactoryCreateMessageReal = chatFactory.createMessage;
        Object.defineProperty(chatFactory, "createMessage", {
          get: () => function (e) {
            console.log("hook chatFactory.createMessage", e);
            // return chatFactoryMessageProcess.apply(chatFactory, arguments)
            return CtrlServer.chatFactoryCreateMessage(chatFactoryCreateMessageReal, chatFactory).apply(chatFactory, arguments)
          },
          set: (d) => {}
        })

        return ret;
      } : angularBootstrapReal,
      set: (real) => (angularBootstrapReal = real)
    });
  }

  initInjectBundle() {
    const initModules = () => {
      if (!window.$) {
        return setTimeout(initModules, 3000);
      }

      MentionMenu.init();
      BadgeCount.init();
      this.ctrlServer.init();
    };

    window.onload = () => {
      initModules();
      window.addEventListener('online', () => {
        ipcRenderer.send('reload', true);
      });
    };
  }

  transformResponse(value, constants) {
    if (!value) return value;

    switch (typeof value) {
      case 'object':
        /* Inject emoji stickers and prevent recalling. */
        return this.checkEmojiContent(value, constants);
      case 'string':
        /* Inject share sites to menu. */
        return this.checkTemplateContent(value);
    }
    return value;
  }

  static lock(object, key, value) {
    return Object.defineProperty(object, key, {
      get: () => value,
      set: () => {
      },
    });
  }

  checkEmojiContent(value, constants) {
    if (!(value.AddMsgList instanceof Array)) return value;
    value.AddMsgList.forEach((msg) => {
      switch (msg.MsgType) {
        case constants.MSGTYPE_EMOTICON:
          Injector.lock(msg, 'MMDigest', '[Emoticon]');
          Injector.lock(msg, 'MsgType', constants.MSGTYPE_EMOTICON);
          if (msg.ImgHeight >= Common.EMOJI_MAXIUM_SIZE) {
            Injector.lock(msg, 'MMImgStyle', { height: `${Common.EMOJI_MAXIUM_SIZE}px`, width: 'initial' });
          } else if (msg.ImgWidth >= Common.EMOJI_MAXIUM_SIZE) {
            Injector.lock(msg, 'MMImgStyle', { width: `${Common.EMOJI_MAXIUM_SIZE}px`, height: 'initial' });
          }
          break;
        case constants.MSGTYPE_RECALLED:
          Injector.lock(msg, 'MsgType', constants.MSGTYPE_SYS);
          Injector.lock(msg, 'MMActualContent', Common.MESSAGE_PREVENT_RECALL);
          Injector.lock(msg, 'MMDigest', Common.MESSAGE_PREVENT_RECALL);
          break;
      }
    });
    return value;
  }

  checkTemplateContent(value) {
    const optionMenuReg = /optionMenu\(\);/;
    const messageBoxKeydownReg = /editAreaKeydown\(\$event\)/;
    if (optionMenuReg.test(value)) {
      value = value.replace(optionMenuReg, 'optionMenu();shareMenu();');
    } else if (messageBoxKeydownReg.test(value)) {
      value = value.replace(messageBoxKeydownReg, 'editAreaKeydown($event);mentionMenu($event);');
    }
    return value;
  }
}

new Injector().init();
