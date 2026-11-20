怎么用（第一次）
==================================================
把这一整个 tools 文件夹放进形象包：

    D:\coopa\Coopanion\data\figures\<形象包 id>\tools\

（<形象包 id> 就是 mizuki-v3，装好包之后就有这个目录。）
然后双击里面的 media.cmd 即可；想一劳永逸就双击 make-shortcut.cmd 在桌面建个快捷方式。

注意：只有放在 <形象包>\tools\ 里，"发射"才会生效（它要把图放进包里、桌宠才读得到）；
单独放在别处运行时，它只会打开文件夹，并提示你放回去。


media.cmd / media.ps1 —— 让桌宠自己"发表情包"的小工具
==================================================

双击 media.cmd，它会做三件事：
  1. 打开 Coopanion 的安装文件夹（资源管理器）；
  2. 打开 它自己的 data\media 文件夹（没有就建一个）；
  3. 从这个 media 里随手挑一张图，转成 PNG 交给形象包，
     桌宠会在两秒内把这张图举到角色身边，停几秒再淡出。

把 png / jpg 丢进 data\media，多放几张，每次双击就会随机挑一张——
"让 Coo 自己选"就是这个意思。


一、它怎么找 Coopanion（不扫盘）
--------------------------------
按开销从低到高，最多读 4 个地方，每个都只读"定点"，从不遍历磁盘：

  1. %LOCALAPPDATA%\Coopanion\data-location.json
     Coopanion 每次启动都会覆写这个一百多字节的小文件，里面就两个绝对路径：
     program（安装位置）和 data（数据目录）。装到 D 盘、E 盘、移动硬盘都一样准。
  2. 正在运行的 Coopanion 进程路径（Get-Process，一次系统调用）。
  3. 注册表卸载项里的 DisplayIcon / InstallLocation（HKCU、HKLM 两个 32/64 位视图）。
  4. 几个固定默认安装位置（只是对几个字面路径 Test-Path 一下，不递归）：
     %LOCALAPPDATA%\Programs\Coopanion、%ProgramFiles%\Coopanion、%ProgramFiles(x86)%\Coopanion

每条来源都要通过校验才采信：程序目录里必须有 Coopanion.exe，
数据目录里必须有 home / logs / figures / pet-window 之一。
校验不过就换下一条，四条都不行才提示"没找到"。

全程只做：读 1 个小 JSON、查 1 次进程、读几个注册表值、Test-Path 几个字面路径。
不扫盘、不遍历、不写注册表、不装服务、不需要管理员权限。


二、形象包怎么知道"有新图了"
----------------------------
形象包的代码跑在沙箱里，不能读文件，也不能开资源管理器。所以：
  · 工具把挑中的图存成 <形象包>\media\current.png
  · 同时把 <形象包>\media\stamp.png 刷成一张 4×4 的新图，并把"发射时刻"写进它的像素里
  · 形象包里的 sticker.js 每隔 1.7 秒只读一下 stamp.png（几十字节的本地请求），
    发现是新图像、并且发射时间在 90 秒内，才去读 current.png 并把它举出来
  · 读的是形象包自己的本地目录，不联网
  · 超过 90 秒的旧信号不弹，所以重启桌宠不会把上次那张再举一遍


按心情自动发（不用再点）
==================================================
想让桌宠自己按现在的心情发表情包，就在 data\media 里按心情分文件夹：

    D:\coopa\Coopanion\data\media\happy\*.png      开心
    D:\coopa\Coopanion\data\media\love\*.png       喜欢 / 爱心眼
    D:\coopa\Coopanion\data\media\angry\*.png      生气 / 认真
    D:\coopa\Coopanion\data\media\sad\*.png        难过 / 哭 / 担心
    D:\coopa\Coopanion\data\media\shy\*.png        害羞 / 慌张
    D:\coopa\Coopanion\data\media\surprised\*.png  惊讶 / 害怕
    D:\coopa\Coopanion\data\media\sleepy\*.png     犯困 / 睡着
    D:\coopa\Coopanion\data\media\excited\*.png    兴奋 / 期待
    D:\coopa\Coopanion\data\media\thinking\*.png   思考
    D:\coopa\Coopanion\data\media\smug\*.png       得意
    D:\coopa\Coopanion\data\media\pout\*.png       嘟嘴
    D:\coopa\Coopanion\data\media\confused\*.png   疑惑 / 晕
    D:\coopa\Coopanion\data\media\*.png             通用（哪个心情都可能用）

中文文件夹名也认：开心/喜欢/生气/难过/害羞/惊讶/困/兴奋/思考/得意/嘟嘴/疑惑/通用。

放好之后，双击一次 sync-moods.cmd（或 media.cmd sync）把图同步进形象包。
之后就不用了：桌宠每隔 26~62 秒左右，看自己当前是什么表情，
就去对应心情的文件夹里随手抽一张举起来；那个心情没有图就退回"通用"。

想停下：删掉形象包里的 media\moods 文件夹即可。手动发射（media.cmd）不受影响。

三、命令行用法
--------------
  media.cmd                 打开两个文件夹 + 随机发射一张
  media.cmd open            只打开文件夹
  media.cmd fire            只发射（不弹文件夹）
  media.cmd fire -Image "D:\pics\a.png"   发射指定图片
  media.cmd list            列出 media 里可用的图
  media.cmd sync            把 data\media 里按心情分好的图同步进形象包（之后自动发）

  -NoOpen   完全不弹资源管理器
  -Quiet    少打印
  -MaxSize  发射前把图缩到最长边多少像素（默认 512，省内存）


四、范围与安全
--------------
  · 只碰两个地方：Coopanion\data\media（挑图）和本形象包自己的 media 目录（放图）
  · data\media 不存在时只新建这一个目录
  · 同步功能会重建本形象包 media\moods 缓存；不修改外部原图，不改系统配置，不联网
  · 图片用系统自带的 System.Drawing 读入、缩小、另存为真正的 PNG，
    遇到 webp 之类读不了的格式会直接跳过
