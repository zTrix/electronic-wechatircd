
# Electronic Wechatircd

electronic-wechatircd 将微信网页版转换成 IRC Server，可以使用 IRC 客户端连接和控制，可以收发微信消息、加好友、修改群名、邀请删除成员、发送附件等。

这个项目是 https://github.com/geeeeeeeeek/electronic-wechat 与 https://github.com/MaskRay/wechatircd 的合体项目。

## 合体之后修改的部分

Server 部分：

页面注入的部分：

`CtrlServer->constructor` 里面，同步联系人时间改为 10s 一次。

`chatFactory.setCurrentUserName(old)` 之前，检查 old 是否为空。

## 安装

TODO

## IRC 客户端使用

TODO

## 在服务器运行保持在线

TODO

## 日志记录

TODO

## 实现 Bot 机器人

TODO

## 浏览图片、下载文件

TODO
