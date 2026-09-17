; NSIS 自定义安装脚本：卸载时清理运行期写入的系统登录项（开机自启）。
; setLoginItemSettings 写的是 HKCU Run 键（app.getName() = Fundet），安装器
; 默认只清自己的键，这里的 customUnInstall 宏补上这一份。
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Fundet"
!macroend
