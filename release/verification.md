# 0.1.12 发行检查

2026-10-24：从已部署且经过兼容验证的维护源白名单复制。7个运行文件SHA-256逐项一致，5个合成测试文件保留。根manifest指定frontend入口，package main指定后端入口，两种原生安装布局均完整。

待发布目录运行npm test，35/35通过。Git保留源文件字节以便校验；校验和覆盖7个源运行文件及2个根入口清单。

已用实际仓库地址完成前后端原生安装、统计入口、心跳及HTTP代码校验；GitHub Actions的Windows／Linux单测通过。详细兼容范围见[兼容性记录](../docs/compatibility.md)。
