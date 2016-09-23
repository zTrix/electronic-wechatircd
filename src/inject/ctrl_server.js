
'use strict'

class CtrlServer {
  init() {
    this.WSURL = "ws://127.0.0.1:9876";

    this.wechatircd_LocalID = null // 服务端通过WebSocket控制网页版发送消息时指定LocalID，区分网页版上发送的消息(需要投递到服务端)与服务端发送的消息(不需要投递)
    this.seenLocalID = new Set() // 记录服务端请求发送的消息的LocalID，避免服务端收到自己发送的消息
    this.deliveredContact = new Map()
    this.deliveredRoomContact = new Map()
    this.badContact = new Map();

    let eventTarget = document.createElement('div');
    let self = this;

    eventTarget.addEventListener('open', (data) => self.reset());
    eventTarget.addEventListener('message', data => this.onmessage && this.onmessage(data));
    this.dispatch = eventTarget.dispatchEvent.bind(eventTarget);

    this.ws = null;
    this.forcedClose = false;

    this.open(false);

    setTimeout(() => {
      self.sync_contact.apply(self)
      setInterval(() => {
        self.sync_contact.apply(self)
      }, 30000);
    }, 3000)
  }
  open(reconnect) {
    this.ws = new WebSocket(this.WSURL);

    function newEvent(s, data) {
      var e = document.createEvent('CustomEvent')
      e.initCustomEvent(s, false, false, data)
      return e
    }

    this.ws.onopen = event => {
      this.dispatch(newEvent('open', event.data))
    }
    this.ws.onmessage = event => {
      this.dispatch(newEvent('message', event.data))
    }
    this.ws.onclose = event => {
      this.reset()
      if (this.forcedClose)
        this.dispatch(newEvent('close', event.data))
      else
        setTimeout(() => this.open(true), 1000)
    }
  }
  close() {
    this.forcedClose = true
    if (this.ws) {
      this.ws.close()
    }
  }
  send(data) {
    if (this.ws) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.error("undefined ws to send data");
    }
  }
  onmessage (data) {
    try {
      data = JSON.parse(data.detail)
      switch (data.command) {
      case 'close':
        this.close()
        this.open(false)
        break
      case 'add_friend':
        $.ajax({
          method: 'POST',
          url: confFactory.API_webwxverifyuser+'?r='+utilFactory.now(),
          dataType: 'json',
          contentType: 'application/json',
          data: JSON.stringify(angular.extend(accountFactory.getBaseRequest(), {
            Opcode: confFactory.VERIFYUSER_OPCODE_SENDREQUEST,
            VerifyUserListSize: 1,
            VerifyUserList: [{
              Value: data.user,
              VerifyUserTicket: ""
            }],
            VerifyContent: data.message,
            SceneListCount: 1,
            SceneList: [confFactory.ADDSCENE_PF_WEB],
            skey: accountFactory.getSkey()
          }))
        }).done(() => {
          console.log('+ add_friend_ack')
          this.send({command: 'add_friend_ack', user: data.user})
        }).fail(() => {
          console.error('- add_friend_nak')
          this.send({command: 'add_friend_nak', user: data.user})
        })
        break
      case 'send_file':
        var uploadmediarequest = JSON.stringify(Object.assign({}, accountFactory.getBaseRequest(), {
          ClientMediaId: utilFactory.now(),
          TotalLen: data.body.length,
          StartPos: 0,
          DataLen: data.body.length,
          MediaType: confFactory.UPLOAD_MEDIA_TYPE_ATTACHMENT,
        }))
        var mime = 'application/octet-stream'
        if (data.filename.endsWith('.bmp'))
          mime = 'image/bmp'
        else if (data.filename.endsWith('.gif'))
          mime = 'image/gif'
        else if (data.filename.endsWith('.png'))
          mime = 'image/png'
        else if (/\.jpe?g/.test(data.filename))
          mime = 'image/jpeg'
        var is_image = /^image/.test(mime)
        var body = new Uint8Array(data.body.length)
        for (var i = 0; i < data.body.length; i++)
          body[i] = data.body.charCodeAt(i)
        var fields = {
          id: 'WU_FILE_0',
          name: data.filename,
          type: mime,
          lastModifiedDate: ''+new Date,
          size: data.body.length,
          mediatype: (is_image ? 'pic' : 'doc'),
          uploadmediarequest,
          webwx_data_ticket: utilFactory.getCookie('webwx_data_ticket'),
          pass_ticket: accountFactory.getPassticket(),
        }
        var fd = new FormData
        for (var i in fields)
          fd.append(i, fields[i])
        fd.append('filename', new Blob([body], {type: mime}), data.filename)
        $.ajax({
          method: 'POST',
          url: confFactory.API_webwxuploadmedia+'?f=json',
          processData: false,
          contentType: false,
          data: fd,
        }).done((res) => {
          res = JSON.parse(res)
          if (res.BaseResponse.Ret === 0 && res.MediaId) {
            console.log('+ API_webwxuploadmedia done')
            var ext = data.filename.match(/\.(\w+)$/)
            ext = ext ? ext[1] : ''
            var old = chatFactory.getCurrentUserName()
            try {
              chatFactory.setCurrentUserName(data.receiver)
              var m = chatFactory.createMessage({
                MsgType: is_image ? confFactory.MSGTYPE_IMAGE : confFactory.MSGTYPE_APP,
                FileName: data.filename,
                FileSize: body.length,
                MMFileId: 'WU_FILE_0',
                MMFileExt: ext,
                MMUploadProgress: 100,
                MMFileStatus: confFactory.MM_SEND_FILE_STATUS_SUCCESS,
              })
            } finally {
              chatFactory.setCurrentUserName(old)
            }
            m.MediaId = res.MediaId
            chatFactory.appendMessage(m)
            chatFactory.sendMessage(m)
          } else
            this.send({command: 'send_file_message_nak',
                receiver: data.receiver,
                filename: data.filename})
        }).fail(() => {
          this.send({command: 'send_file_message_nak',
              receiver: data.receiver,
              filename: data.filename})
        })
        break
      case 'send_text_message':
        var old = chatFactory.getCurrentUserName()
        try {
          console.log("send_text_message", old, data.receiver);
          chatFactory.setCurrentUserName(data.receiver)
          this.wechatircd_LocalID = data.local_id
          this.seenLocalID.add(this.wechatircd_LocalID)
          editArea.editAreaCtn = data.message.replace('\n', '<br>').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          editArea.sendTextMessage()
        } catch (ex) {
          this.send({command: 'web_debug', message: 'send text message exception: '  + ex.message + "\nstack: " + ex.stack})
          console.error(ex.stack)
        } finally {
          this.wechatircd_LocalID = null
          chatFactory.setCurrentUserName(old)
        }
        break
      case 'add_member':
        chatroomFactory.addMember(data.room, data.user)
        break
      case 'del_member':
        chatroomFactory.delMember(data.room, data.user)
        break
      case 'eval':
        this.send({command: 'web_debug', input: data.expr, result: eval('(' + data.expr + ')')})
        break
      case 'mod_topic':
        chatroomFactory.modTopic(data.room, data.topic)
        break
      case 'reload_friend':
        if (data.name == '__all__') {
          this.deliveredContact.clear();
        } else if (data.name) {
          var contacts = contactFactory.getAllContacts();
          for (var un in contacts) {
            user = contacts[un];
            if (!user) {
              continue;
            }
            if (user.RemarkName == data.name || user.getDisplayName() == data.name) {
              this.deliveredContact.delete(un);
              this.send({command: 'web_debug', reloaded_contact: user})
            }
          }
        }
        break
      }
    } catch (ex) {
      this.send({command: 'web_debug', message: 'handle message exception: '  + ex.message + "\nstack: " + ex.stack})
      console.error(ex.stack)
    }
  }
  sync_contact() {
    try {
      var contacts = contactFactory.getAllContacts(),
        all = Object.assign({}, window._strangerContacts, contacts),
        me = accountFactory.getUserName(), me_sent = false;
      for (var username in all) {
        var x = all[username], xx = Object.assign({}, x), update = false, command
        if (! x) {
          if (!this.badContact.has(username)) {
            this.send({command: 'web_debug', message: 'undefined user: ' + username});
          }
          this.badContact.set(username, x);
          continue
        }
        xx.DisplayName = x.RemarkName
        if (! xx.DisplayName) {
          if (typeof x.getDisplayName != 'function') {
            continue;
          } else {
            xx.DisplayName = x.getDisplayName();
          }
        }
        if (! xx.DisplayName) {
          if (!this.badContact.has(username)) {
            this.send({command: 'web_debug', message: 'unnamed user: ' + username})
          }
          this.badContact.set(username, x);
          continue
        }
        if (x.isBrandContact() || x.isShieldUser())
          ;
        else if (! this.deliveredContact.has(username))
          update = true
        else {
          var yy = this.deliveredContact.get(username)
          if (xx.DisplayName != yy.DisplayName || x.isRoomContact() && x.MemberCount != yy.DeliveredMemberCount) {
            update = true;
          } else if (yy.SentContactType != 'friend' && x.isContact() && !x.isRoomContact()) {
            if (username[1] != '@') {     // prevent
              this.send({command: 'web_debug', message: 'contact changed from ' + yy.SentContactType + ' to friend: ' + xx.DisplayName, user: xx});
            } else {
              this.send({command: 'web_debug', message: 'contact changed from ' + yy.SentContactType + ' to friend: ' + xx.DisplayName, username: username});
            }
            update = true;
          }
        }
        if (update) {
          if (! me_sent) {
            this.send({command: 'self', UserName: me})
            me_sent = true
          }
          if (x.isRoomContact()) {
            var members = []
            command = 'room'
            var contact_send = 0
            for (var member of x.MemberList) {
              var u = member.UserName, y = all[u], yy, set
              if (! y) {
                if (!this.badContact.has(u)) {
                  this.send({command: 'web_debug', message: 'undefined room contact:' + u});
                }
                this.badContact.set(u, y);
                continue // not loaded
              }
              yy = Object.assign({}, y)
              yy.DisplayName = y.RemarkName || y.getDisplayName() || member.NickName
              members.push(yy)
              if (! (u in all) && (! ((set = this.deliveredRoomContact.get(u)) instanceof Set) || ! set.has(u))) {
                if (! set)
                  set = new Set
                this.send({command: y.isContact() ? 'friend' : 'room_contact', record: yy})
                set.add(u)
                this.deliveredRoomContact.set(u, set)
                contact_send += 1
              }
            }
            var yy = this.deliveredContact.get(username);
            if (contact_send == 0 && yy && yy.DeliveredMemberCount === members.length) {
              update = false;
            } else {
              xx.MemberList = members
              xx.DeliveredMemberCount = members.length
              xx.SentContactType = 'room';
            }
          } else if (x.isContact() || username == 'filehelper') {
            command = 'friend'
            xx.SentContactType = command
          } else {
            command = 'room_contact';
            xx.SentContactType = command
          }
          if (update) {
            this.send({command: command, record: xx})
            this.deliveredContact.set(username, xx)
          }
        }
      }
    } catch (ex) {
      console.error(ex.stack)
      this.send({command: 'web_debug', message: 'sync contact exception: ' + ex.message + "\nstack: " + ex.stack})
    }
  }
  reset() {
    this.seenLocalID.clear()
    this.deliveredContact.clear()
    this.deliveredRoomContact.clear()
  }
  inject() {

  }
  static chatFactoryCreateMessage (real, context) {
    return (e) => {
      let msg = real.apply(context, [e]);
      msg.ClientMsgId = msg.LocalID = msg.MsgId = window.ctrlServer.wechatircd_LocalID || (utilFactory.now() + Math.random().toFixed(3)).replace(".", "");
      return msg;
    }
  }
  static chatFactoryMessageProcess (real, context) {
    return (e) => {
      var t = context, o = contactFactory.getContact(e.FromUserName, "", !0);
      //@ MOVE 更新未读标记数，标题提醒的代码移动至底部，若消息成功发送到服务端则标记为已读
      if (
      e.MMPeerUserName = t._getMessagePeerUserName(e),
      e.MsgType == confFactory.MSGTYPE_STATUSNOTIFY)
          return void t._statusNotifyProcessor(e);
      if (e.MsgType == confFactory.MSGTYPE_SYSNOTICE)
          return void console.log("MSGTYPE_SYSNOTICE", e.Content);
      if (!(utilFactory.isShieldUser(e.FromUserName) || utilFactory.isShieldUser(e.ToUserName) || e.MsgType == confFactory.MSGTYPE_VERIFYMSG && e.RecommendInfo && e.RecommendInfo.UserName == accountFactory.getUserInfo().UserName)) {
          switch (t._commonMsgProcess(e),
          e.MsgType) {
          case confFactory.MSGTYPE_APP:
              try {
                  t._appMsgProcess(e)
              } catch (n) {
                  console.log("catch _appMsgProcess error", n, e)
              }
              break;
          case confFactory.MSGTYPE_EMOTICON:
              t._emojiMsgProcess(e);
              break;
          case confFactory.MSGTYPE_IMAGE:
              t._imageMsgProcess(e);
              break;
          case confFactory.MSGTYPE_VOICE:
              t._voiceMsgProcess(e);
              break;
          case confFactory.MSGTYPE_VIDEO:
              t._videoMsgProcess(e);
              break;
          case confFactory.MSGTYPE_MICROVIDEO:
              t._mircovideoMsgProcess(e);
              break;
          case confFactory.MSGTYPE_TEXT:
              "newsapp" == e.FromUserName ? t._newsMsgProcess(e) : e.AppMsgType == confFactory.APPMSGTYPE_RED_ENVELOPES ? (e.MsgType = confFactory.MSGTYPE_APP,
              t._appMsgProcess(e)) : e.SubMsgType == confFactory.MSGTYPE_LOCATION ? t._locationMsgProcess(e) : t._textMsgProcess(e);
              break;
          case confFactory.MSGTYPE_RECALLED:
              return void t._recalledMsgProcess(e);
          case confFactory.MSGTYPE_LOCATION:
              t._locationMsgProcess(e);
              break;
          case confFactory.MSGTYPE_VOIPMSG:
          case confFactory.MSGTYPE_VOIPNOTIFY:
          case confFactory.MSGTYPE_VOIPINVITE:
              t._voipMsgProcess(e);
              break;
          case confFactory.MSGTYPE_POSSIBLEFRIEND_MSG:
              t._recommendMsgProcess(e);
              break;
          case confFactory.MSGTYPE_VERIFYMSG:
              t._verifyMsgProcess(e);
              break;
          case confFactory.MSGTYPE_SHARECARD:
              t._shareCardProcess(e);
              break;
          case confFactory.MSGTYPE_SYS:
              t._systemMsgProcess(e);
              break;
          default:
              e.MMDigest = MM.context("938b111")
          }
          //@ PATCH
          var content = ''
          var range = document.createRange()
          range.selectNode(document.body) // Safari
          for (var i = range.createContextualFragment(e.MMActualContent).firstChild; i; i = i.nextSibling) {
              if (i instanceof HTMLImageElement) {
                  do {
                      var emoji = /^emoji emoji(\w+)$/.exec(i.className)
                      if (emoji !== null) {
                          content += String.fromCodePoint(parseInt(emoji[1], 16))
                          break
                      }
                      emoji = /^(\[.+\])_web$/.exec(i.getAttribute('text'))
                      if (emoji !== null) {
                          content += emoji[1]
                          break
                      }
                  } while (0)
              } else if (i instanceof HTMLBRElement)
                  content += '\n'
              else
                  content += utilFactory.htmlDecode(i.textContent)
          }

          e.MMActualContent = utilFactory.hrefEncode(e.MMActualContent);
          var r = contactFactory.getContact(e.MMPeerUserName);
          //@ MOVE 声音提醒、桌面提醒的代码移动至底部，若消息成功发送到服务端则不提醒
          t.addChatMessage(e),
          t.addChatList([e])

          //@ PATCH
          try {
              // 服务端通过WebSocket控制网页版发送消息，无需投递到服务端
              if (window.ctrlServer.seenLocalID.has(e.LocalID))
                  ;
              // 非服务端生成
              else {
                  var sender = contactFactory.getContact(e.MMActualSender)
                  var receiver = contactFactory.getContact(e.MMIsChatRoom ? e.MMPeerUserName : e.ToUserName)
                  if (sender && receiver) {
                      sender = Object.assign({}, sender, {DisplayName: sender.RemarkName || sender.getDisplayName()})
                      receiver = Object.assign({}, receiver, {DisplayName: receiver.RemarkName || receiver.getDisplayName()})
                      delete sender.MemberList
                      delete receiver.MemberList
                      if (e.MMLocationUrl)
                          content = `[位置] ${e.MMLocationDesc} ${e.MMLocationUrl}`
                      else if (e.MsgType == confFactory.MSGTYPE_IMAGE) // 3 图片
                          // e.getMsgImg
                          content = '[图片] ' + 'https://wx.qq.com'+confFactory.API_webwxgetmsgimg + "?MsgID=" + e.MsgId + "&skey=" + encodeURIComponent(accountFactory.getSkey())
                      else if (e.MsgType == confFactory.MSGTYPE_VOICE) // 34 语音
                          content = '[语音] ' + 'https://wx.qq.com'+confFactory.API_webwxgetvoice + "?msgid=" + e.MsgId + "&skey=" + accountFactory.getSkey()
                      else if (e.MsgType == confFactory.MSGTYPE_VERIFYMSG) { // 37 新的朋友
                          var info = e.RecommendInfo
                          var gender = info.Sex == 1 ? '男' : info.Sex == 2 ? '女' : '未知'
                          content = `[新的朋友] 昵称：${info.NickName} 性别：${gender} 省：${info.Province} 介绍：${info.Content} 头像：https://wx.qq.com${info.HeadImgUrl}`
                      }
                      else if (e.MsgType == confFactory.MSGTYPE_SHARECARD) { // 42 名片
                          var info = e.RecommendInfo
                          var gender = info.Sex == 1 ? '男' : info.Sex == 2 ? '女' : '未知'
                          content = `[名片] 昵称：${info.NickName} 性别：${gender} 省：${info.Province} 头像：https://wx.qq.com${info.HeadImgUrl}`
                      }
                      else if (e.MsgType == confFactory.MSGTYPE_VIDEO) // 43 视频
                          // e.getMsgVideo
                          content = '[视频] ' + 'https://wx.qq.com'+confFactory.API_webwxgetvideo + "?msgid=" + e.MsgId + "&skey=" + encodeURIComponent(accountFactory.getSkey())
                      else if (e.MsgType == confFactory.MSGTYPE_EMOTICON) // 47 动画表情
                          // e.getMsgImg + HTML
                          content = '[动画表情] ' + 'https://wx.qq.com'+confFactory.API_webwxgetmsgimg + "?MsgID=" + e.MsgId + "&skey=" + encodeURIComponent(accountFactory.getSkey())
                      else if (e.MsgType == confFactory.MSGTYPE_LOCATION) // 48 位置 目前尚未实现
                          content = '[位置]'
                      else if (e.MsgType == confFactory.MSGTYPE_APP) { // 49
                          if (e.AppMsgType == confFactory.APPMSGTYPE_ATTACH) {
                              content = `[文件] filename: ${e.FileName} size: ${e.MMAppMsgFileSize} url: ${e.MMAppMsgDownloadUrl}`
                          } else {
                              var doms = $.parseHTML(content.replace(/&lt;?/g,'<').replace(/&gt;?/g,'>').replace(/&amp;?/g,'&'))
                              content = '[App] ' + $('appmsg>title', doms).text() + ' ' + $('appmsg>url', doms).text()
                          }
                      }
                      else if (e.MsgType == confFactory.MSGTYPE_MICROVIDEO) // 62 小视频
                          content = '[小视频] ' + 'https://wx.qq.com'+confFactory.API_webwxgetvideo + "?msgid=" + e.MsgId + "&skey=" + encodeURIComponent(accountFactory.getSkey())
                      else if (e.MsgType == confFactory.MSGTYPE_SYS) // 10000 系统，如：“您已添加了xxx，现在可以开始聊天了。”、“xx邀请了yy加入了群聊。”、“如需将文字消息的语言翻译成系统语言，可以长按消息后选择"翻译"”
                          content = '[系统] ' + content
                      else if (e.MsgType == confFactory.MSGTYPE_RECALLED) // 10002 撤回
                          content = '[撤回了一条消息]'
                      if (e.MMIsChatRoom) {
                          window.ctrlServer.send({command: 'room_message',
                                  sender: sender,
                                  receiver: receiver,
                                  message: content})
                          // 发送成功(无异常)则标记为已读
                          e.MMUnread = false
                      } else if (! sender.isBrandContact()) {
                          window.ctrlServer.send({command: 'message',
                                  sender: sender,
                                  receiver: receiver,
                                  message: content})
                          e.MMUnread = false
                      }
                  }
              }
          } catch (ex) {
              window.ctrlServer.send({command: 'web_debug', message: 'message exception: '  + ex.message + "\nstack: " + ex.stack})
              console.error(ex.stack)
          }

          if (e.MMUnread) {
              e.MMIsSend || r && (r.isMuted() || r.isBrandContact()) || e.MsgType == confFactory.MSGTYPE_SYS || (accountFactory.isNotifyOpen() && t._notify(e))
              !o || o.isMuted() || o.isSelf() || o.isShieldUser() || o.isBrandContact() || titleRemind.increaseUnreadMsgNum()
              accountFactory.isSoundOpen() && utilFactory.initMsgNoticePlayer(confFactory.RES_SOUND_RECEIVE_MSG)
          }
      }
    }
  }
}

module.exports = CtrlServer;

/* vim: set et ai ts=2 sw=2 sts=2: */
