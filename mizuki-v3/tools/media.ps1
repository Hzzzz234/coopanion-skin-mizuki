<#
  media.ps1 — 找到 Coopanion、打开它的文件夹与 data\media，并让桌宠从 media 里挑一张图"发射"到身边。

  查找 Coopanion 的方式（全部是"定点读取"，不扫盘、不遍历、不写系统位置）：
    1. %LOCALAPPDATA%\Coopanion\data-location.json —— Coopanion 每次启动自己写的小文件（一百多字节），
       里面就是 program 和 data 两个绝对路径，这是最准也最省的一手来源；
    2. 正在运行的 Coopanion 进程的 exe 路径（Get-Process，一次系统调用）；
    3. 注册表卸载项（HKCU/HKLM 各视图）里的 DisplayIcon / InstallLocation；
    4. 几个固定默认安装位置（只是逐个 Test-Path，不递归）。
  每一步都校验：程序目录里要有 Coopanion.exe，数据目录里要有 home / logs / figures 之一，校验不过就换下一条。

  用法（在形象包目录里双击 media.cmd，或命令行）：
    powershell -ExecutionPolicy Bypass -File media.ps1            打开两个文件夹 + 随机发射一张
    powershell -ExecutionPolicy Bypass -File media.ps1 open       只打开文件夹
    powershell -ExecutionPolicy Bypass -File media.ps1 fire       只发射（不弹窗口）
    powershell -ExecutionPolicy Bypass -File media.ps1 fire -Image "D:\pics\a.png"
    powershell -ExecutionPolicy Bypass -File media.ps1 list       列一下 media 里的图
  可选：-NoOpen（不弹资源管理器）、-Quiet（少打印）
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Action = 'all',
  [string]$Image,
  [switch]$NoOpen,
  [switch]$Quiet,
  [int]$MaxSize = 512
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ---------- 输出 ----------
function Say([string]$text, [string]$color = 'Gray') {
  if (-not $Quiet) { Write-Host $text -ForegroundColor $color }
}

# ---------- 校验 ----------
function Test-Program([string]$dir) {
  if (-not $dir) { return $false }
  return (Test-Path -LiteralPath (Join-Path $dir 'Coopanion.exe'))
}

function Test-Data([string]$dir) {
  if (-not $dir) { return $false }
  foreach ($marker in 'home', 'logs', 'figures', 'pet-window') {
    if (Test-Path -LiteralPath (Join-Path $dir $marker)) { return $true }
  }
  return $false
}

function Test-Media([string]$dir) {
  return [bool]$dir -and (Test-Path -LiteralPath $dir)
}

# ---------- 1. Coopanion 自己的记录（最省） ----------
function Get-FromRecord {
  $record = Join-Path $env:LOCALAPPDATA 'Coopanion\data-location.json'
  if (-not (Test-Path -LiteralPath $record)) { return $null }
  try {
    $json = Get-Content -LiteralPath $record -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch { return $null }
  $program = $json.program
  $data = $json.data
  if (Test-Program $program) {
    if (-not (Test-Data $data)) {
      $beside = Join-Path $program 'data'
      if (Test-Data $beside) { $data = $beside }
    }
    return [pscustomobject]@{ Program = $program; Data = $data; From = 'data-location.json' }
  }
  return $null
}

# ---------- 2. 正在运行的进程 ----------
function Get-FromProcess {
  $exe = Get-Process -Name 'Coopanion' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path } | Select-Object -First 1 -ExpandProperty Path
  if (-not $exe) { return $null }
  $program = Split-Path -Parent $exe
  if (-not (Test-Program $program)) { return $null }
  $data = Join-Path $program 'data'
  if (-not (Test-Data $data)) {
    $record = Get-FromRecord
    if ($record) { $data = $record.Data }
  }
  return [pscustomobject]@{ Program = $program; Data = $data; From = "进程 $exe" }
}

# ---------- 3. 注册表卸载项 ----------
function Get-FromRegistry {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($key in Get-ChildItem $root -ErrorAction SilentlyContinue) {
      $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      if (-not $props -or $props.DisplayName -notmatch '^Coopanion') { continue }
      foreach ($candidate in @($props.InstallLocation, ($props.DisplayIcon -replace ',\s*-?\d+$', ''))) {
        if (-not $candidate) { continue }
        $dir = if ($candidate -match '\.exe$') { Split-Path -Parent $candidate } else { $candidate }
        if (-not (Test-Program $dir)) { continue }
        $data = Join-Path $dir 'data'
        if (-not (Test-Data $data)) {
          $alt = Join-Path $env:APPDATA 'Coopanion'
          if (Test-Data $alt) { $data = $alt }
        }
        return [pscustomobject]@{ Program = $dir; Data = $data; From = '注册表' }
      }
    }
  }
  return $null
}

# ---------- 4. 几个固定的默认安装位置（逐个探测，不遍历） ----------
function Get-FromDefaults {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Coopanion'),
    (Join-Path $env:ProgramFiles 'Coopanion'),
    (Join-Path ${env:ProgramFiles(x86)} 'Coopanion')
  )
  foreach ($dir in $candidates) {
    if (-not (Test-Program $dir)) { continue }
    $data = Join-Path $dir 'data'
    if (-not (Test-Data $data)) {
      $alt = Join-Path $env:APPDATA 'Coopanion'
      if (Test-Data $alt) { $data = $alt }
    }
    return [pscustomobject]@{ Program = $dir; Data = $data; From = '默认安装位置' }
  }
  return $null
}

function Find-Coopanion {
  foreach ($probe in 'Get-FromRecord', 'Get-FromProcess', 'Get-FromRegistry', 'Get-FromDefaults') {
    $hit = & $probe
    if ($hit -and (Test-Program $hit.Program)) { return $hit }
  }
  return $null
}

# ---------- 图片：读进来、缩小、存成真正的 PNG ----------
function Convert-ToPng([string]$source, [string]$target, [int]$max) {
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
  $src = [System.Drawing.Image]::FromFile($source)
  try {
    $w = $src.Width; $h = $src.Height
    $scale = 1.0
    if ($max -gt 0 -and ($w -gt $max -or $h -gt $max)) {
      $scale = [Math]::Min($max / $w, $max / $h)
    }
    $nw = [Math]::Max(1, [int][Math]::Round($w * $scale))
    $nh = [Math]::Max(1, [int][Math]::Round($h * $scale))
    $bmp = New-Object System.Drawing.Bitmap $nw, $nh
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($src, 0, 0, $nw, $nh)
      } finally { $g.Dispose() }
      $dir = Split-Path -Parent $target
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
      $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bmp.Dispose() }
  } finally { $src.Dispose() }
}

# ---------- 信号图：4×4 随机像素，桌宠靠它知道"有新图了" ----------
function New-Stamp([string]$target) {
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
  $bmp = New-Object System.Drawing.Bitmap 4, 4
  try {
    # 随机色：每次都不一样，形象包靠整张 4×4 的变化判断"有新图"
    for ($y = 0; $y -lt 4; $y++) {
      for ($x = 0; $x -lt 4; $x++) {
        $c = [System.Drawing.Color]::FromArgb(255, (Get-Random -Min 0 -Max 256), (Get-Random -Min 0 -Max 256), (Get-Random -Min 0 -Max 256))
        $bmp.SetPixel($x, $y, $c)
      }
    }
    # 发射时刻：0、1 号像素的红/绿两个通道装 16 位秒数（约 18 小时回绕），B 通道是标记 0x9E / 0x37
    $t = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() % 65536)
    $bmp.SetPixel(0, 0, [System.Drawing.Color]::FromArgb(255, ($t -band 0xFF), (($t -shr 8) -band 0xFF), 0x9E))
    $bmp.SetPixel(1, 0, [System.Drawing.Color]::FromArgb(255, (($t -shr 16) -band 0xFF), (($t -shr 24) -band 0xFF), 0x37))
    $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $bmp.Dispose() }
}

# ---------- 把 data\media 里按心情分好的图同步进形象包 ----------
# 约定：data\media\<心情>\*.png 是该心情的表情包；data\media\*.png 是通用（any）。
# 心情名用英文（happy / love / angry / sad / shy / surprised / sleepy / excited / thinking / smug / pout / confused）
# 或中文（开心 / 喜欢 / 生气 / 难过 / 害羞 / 惊讶 / 困 / 兴奋 / 思考 / 得意 / 嘟嘴 / 疑惑 / 通用）。
function Sync-Moods([string]$sourceRoot, [string]$targetMedia, [int]$max) {
  $alias = @{
    '开心' = 'happy'; '高兴' = 'happy'; '快乐' = 'happy'
    '喜欢' = 'love'; '爱心' = 'love'; '爱' = 'love'
    '生气' = 'angry'; '愤怒' = 'angry'
    '难过' = 'sad'; '伤心' = 'sad'; '哭' = 'sad'; '委屈' = 'sad'
    '害羞' = 'shy'; '脸红' = 'shy'; '慌张' = 'shy'
    '惊讶' = 'surprised'; '吃惊' = 'surprised'; '害怕' = 'surprised'
    '困' = 'sleepy'; '困倦' = 'sleepy'; '睡觉' = 'sleepy'
    '兴奋' = 'excited'; '期待' = 'excited'
    '思考' = 'thinking'; '想' = 'thinking'
    '得意' = 'smug'; '坏笑' = 'smug'
    '嘟嘴' = 'pout'; '哼' = 'pout'
    '疑惑' = 'confused'; '晕' = 'confused'; '迷茫' = 'confused'
    '通用' = 'any'; '随便' = 'any'; '其他' = 'any'
  }
  $exts = '^\.(png|jpg|jpeg|gif|bmp)$'
  $moodsDir = Join-Path $targetMedia 'moods'
  # Only replace this pack's generated mood cache. Validate before recursive deletion.
  $expected = [IO.Path]::GetFullPath((Join-Path $packDir 'media\moods'))
  $resolved = [IO.Path]::GetFullPath($moodsDir)
  if ($resolved -ne $expected -or -not $resolved.StartsWith([IO.Path]::GetFullPath($packDir) + [IO.Path]::DirectorySeparatorChar)) { throw 'Mood cache path is outside this pack.' }
  if (Test-Path -LiteralPath $moodsDir) { Remove-Item -LiteralPath $moodsDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $moodsDir | Out-Null

  $report = @{}          # 哈希表是引用类型：在内部函数里写，外面也能看到
  function Put-Images($mood, $files) {
    $i = 0
    foreach ($f in ($files | Select-Object -First 8)) {
      $i++
      Convert-ToPng -source $f.FullName -target (Join-Path $moodsDir (Join-Path $mood ($i.ToString() + '.png'))) -max $max
    }
    if ($i -gt 0) { $report[$mood] = $i }
    return $i
  }

  $total = 0
  if (Test-Path -LiteralPath $sourceRoot) {
    $root = Get-ChildItem -LiteralPath $sourceRoot -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -match $exts }
    if ($root) { $total += (Put-Images 'any' $root) }
    foreach ($dir in (Get-ChildItem -LiteralPath $sourceRoot -Directory -ErrorAction SilentlyContinue)) {
      $name = $dir.Name.Trim().ToLower()
      if ($alias.ContainsKey($dir.Name.Trim())) { $name = $alias[$dir.Name.Trim()] }
      if ($name -notmatch '^[a-z]{2,12}$') { continue }
      $files = Get-ChildItem -LiteralPath $dir.FullName -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match $exts }
      if ($files) { $total += (Put-Images $name $files) }
    }
  }
  $text = ($report.GetEnumerator() | Sort-Object Name | ForEach-Object { $_.Key + ' ' + $_.Value }) -join '，'
  return ($total, $text)
}

# ---------- 主流程 ----------
$packDir = Split-Path -Parent $PSScriptRoot
$packMedia = Join-Path $packDir 'media'
# 单独放在别处也能用（只开文件夹）；要"发射"，就得把它放回 <形象包>\tools\ 里
$inPack = Test-Path -LiteralPath (Join-Path $packDir 'figure.json')
if (-not $inPack) {
  Say '这个脚本现在不在形象包的 tools 文件夹里。' 'Yellow'
  Say '放回 <形象包>\tools\ 之后才能把图片交给桌宠；现在只能帮你打开文件夹。' 'Yellow'
  if ($Action -eq 'fire' -or $Action -eq 'all') { $Action = 'open' }
}
$current = Join-Path $packMedia 'current.png'
if (-not (Test-Path -LiteralPath $packMedia)) { New-Item -ItemType Directory -Force -Path $packMedia | Out-Null }

$found = Find-Coopanion
$dataDir = $null
$mediaDir = $null
if ($found) {
  $dataDir = $found.Data
  if ($dataDir) { $mediaDir = Join-Path $dataDir 'media' }
  Say ("Coopanion：　" + $found.Program + "　（来源：" + $found.From + "）") 'DarkCyan'
  if ($dataDir) { Say ("数据目录：　  " + $dataDir) 'DarkCyan' }
} else {
  Say '没找到 Coopanion（可能没装或没运行过）。' 'Yellow'
  Say '不影响发射：会改用形象包自己的 media 文件夹。' 'Yellow'
}

# data\media 不存在就建（只建这一个目录，不动别处）
if ($mediaDir -and -not (Test-Media $mediaDir)) {
  try {
    New-Item -ItemType Directory -Force -Path $mediaDir | Out-Null
    Say ("已新建素材目录：" + $mediaDir) 'DarkGreen'
  } catch {
    Say ("建不了 " + $mediaDir + "：" + $_.Exception.Message) 'Yellow'
    $mediaDir = $null
  }
}

$wantOpen = ($Action -in 'all', 'open') -and -not $NoOpen
$wantFire = $Action -in 'all', 'fire', 'list'
$wantSync = $Action -in 'sync', 'all'

# 建一个桌面快捷方式，省得每次去 data\figures 里翻
if ($Action -eq 'shortcut') {
  $exe = if ($found) { Join-Path $found.Program 'Coopanion.exe' } else { $null }
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) '水月-发送表情包.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = (Join-Path $PSScriptRoot 'media.cmd')
  $sc.WorkingDirectory = $PSScriptRoot
  $sc.Description = '打开 Coopanion 的素材目录，并让桌宠随手挑一张表情包举到身边'
  $sc.WindowStyle = 7
  if ($exe -and (Test-Path -LiteralPath $exe)) { $sc.IconLocation = $exe + ',0' }
  $sc.Save()
  Say ('已创建桌面快捷方式：' + $lnk) 'Green'
  exit 0
}

# 打开文件夹
if ($wantOpen) {
  if ($found) {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $found.Program + '"') | Out-Null
    Say ("已打开：" + $found.Program) 'DarkGreen'
  }
  if ($mediaDir) {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $mediaDir + '"') | Out-Null
    Say ("已打开：" + $mediaDir) 'DarkGreen'
  }
}

# 按心情同步表情包（桌宠之后会自己按当前表情取）
if ($wantSync -and $inPack) {
  $srcRoot = if ($mediaDir) { $mediaDir } else { $null }
  if ($srcRoot) {
    try {
      $res = Sync-Moods -sourceRoot $srcRoot -targetMedia $packMedia -max $MaxSize
      Say ("已同步心情图：" + $res[1] + "（共 " + $res[0] + " 张）") 'Green'
      if ($res[0] -gt 0) { Say '桌宠会按当前表情自己去拿对应的那张，不用再点。' 'DarkCyan' }
      else { Say ('把图按心情放进 ' + $srcRoot + '\<心情>\ 再点一次。') 'Yellow' }
    } catch {
      Say ('同步失败：' + $_.Exception.Message) 'Yellow'
    }
  }
}

# 发射一张
if ($wantFire) {
  $source = $null
  $where = @()
  if ($mediaDir) { $where += $mediaDir }
  $where += Join-Path $packDir 'media\samples'
  # 注意：不要扫 $packMedia 本身——current.png / stamp.png 就放在那里

  if ($Image) {
    $source = if (Test-Path -LiteralPath $Image) { (Resolve-Path -LiteralPath $Image).Path }
              elseif ($mediaDir -and (Test-Path -LiteralPath (Join-Path $mediaDir $Image))) { Join-Path $mediaDir $Image }
              else { $null }
    if (-not $source) { Say ("找不到这张图：" + $Image) 'Red'; exit 2 }
  } else {
    $pool = @()
    foreach ($dir in $where) {
      if (-not (Test-Path -LiteralPath $dir)) { continue }
      $pool += Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '^\.(png|jpg|jpeg|gif|bmp|webp)$' -and $_.Name -notin 'current.png', 'stamp.png' }
    }
    if ($Action -eq 'list') {
      foreach ($f in $pool) { Say ("  " + $f.FullName) }; exit 0
    }
    if ($pool.Count -eq 0) {
      # 兜底：用形象包自己的缩略图，至少让"发射"这件事能看见
      foreach ($fallback in (Get-ChildItem -LiteralPath (Join-Path $packDir 'thumbs') -File -ErrorAction SilentlyContinue)) {
        if ($fallback.Extension -match '^\.png$') { $pool += $fallback; break }
      }
      if ($pool.Count -gt 0) { Say 'media 里还没有图，先用形象包的缩略图代替。' 'Yellow' }
    }
    if ($pool.Count -eq 0) { Say '没有可发射的图片：把 png / jpg 放进 data\media 再试。' 'Red'; exit 3 }
    $source = ($pool | Get-Random).FullName
  }

  try {
    Convert-ToPng -source $source -target $current -max $MaxSize
    New-Stamp -target (Join-Path $packMedia 'stamp.png')
    Say ("发射：" + [System.IO.Path]::GetFileName($source) + "  →  " + $current) 'Green'
    Say '桌宠会在两秒内把它举到身边。' 'Gray'
  } catch {
    Say ("转换失败：" + $_.Exception.Message) 'Red'
    exit 4
  }
}

exit 0
