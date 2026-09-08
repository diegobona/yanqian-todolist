Add-Type -AssemblyName System.Drawing

function New-RoundedPath($x, $y, $width, $height, $radius) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-AppIcon($size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.ScaleTransform($size / 256, $size / 256)
  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#173d32'))
  $mint = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#b9f3d3'))
  $background = New-RoundedPath 4 4 248 248 56
  $eye = New-Object System.Drawing.Drawing2D.GraphicsPath
  $eye.AddBezier(36, 128, 58, 82, 94, 60, 128, 60)
  $eye.AddBezier(128, 60, 162, 60, 198, 82, 220, 128)
  $eye.AddBezier(220, 128, 198, 174, 162, 196, 128, 196)
  $eye.AddBezier(128, 196, 94, 196, 58, 174, 36, 128)
  $eye.CloseFigure()
  $graphics.FillPath($dark, $background)
  $graphics.FillPath($mint, $eye)
  $graphics.FillEllipse($dark, 91, 91, 74, 74)
  $graphics.FillEllipse([System.Drawing.Brushes]::White, 132, 104, 20, 20)
  $eye.Dispose()
  $background.Dispose()
  $dark.Dispose()
  $mint.Dispose()
  $graphics.Dispose()
  return $bitmap
}

function Get-PngBytes($bitmap) {
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $stream.Dispose()
  return $bytes
}

function Write-Ico($file, $sizes) {
  $images = @()
  foreach ($size in $sizes) {
    $bitmap = New-AppIcon $size
    $images += ,(Get-PngBytes $bitmap)
    $bitmap.Dispose()
  }
  $stream = [System.IO.File]::Create($file)
  $writer = New-Object System.IO.BinaryWriter $stream
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($index = 0; $index -lt $sizes.Count; $index++) {
    $size = $sizes[$index]
    $sizeByte = if ($size -eq 256) { 0 } else { $size }
    $writer.Write([byte]$sizeByte)
    $writer.Write([byte]$sizeByte)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$index].Length)
    $writer.Write([uint32]$offset)
    $offset += $images[$index].Length
  }
  foreach ($image in $images) { $writer.Write([byte[]]$image) }
  $writer.Dispose()
  $stream.Dispose()
}

function Get-BigEndianBytes([uint32]$value) {
  $bytes = [BitConverter]::GetBytes($value)
  [Array]::Reverse($bytes)
  return $bytes
}

function Write-Icns($file) {
  $chunks = @()
  foreach ($entry in @(@('ic07', 128), @('ic08', 256), @('ic09', 512), @('ic10', 1024))) {
    $bitmap = New-AppIcon $entry[1]
    $chunks += ,@($entry[0], (Get-PngBytes $bitmap))
    $bitmap.Dispose()
  }
  $total = 8
  foreach ($chunk in $chunks) { $total += 8 + $chunk[1].Length }
  $stream = [System.IO.File]::Create($file)
  $writer = New-Object System.IO.BinaryWriter $stream
  $writer.Write([Text.Encoding]::ASCII.GetBytes('icns'))
  $writer.Write([byte[]](Get-BigEndianBytes $total))
  foreach ($chunk in $chunks) {
    $writer.Write([Text.Encoding]::ASCII.GetBytes($chunk[0]))
    $writer.Write([byte[]](Get-BigEndianBytes (8 + $chunk[1].Length)))
    $writer.Write([byte[]]$chunk[1])
  }
  $writer.Dispose()
  $stream.Dispose()
}

function New-TrayTemplate($size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.ScaleTransform($size / 32, $size / 32)
  $eye = New-Object System.Drawing.Drawing2D.GraphicsPath
  $eye.AddBezier(4, 16, 9, 7, 23, 7, 28, 16)
  $eye.AddBezier(28, 16, 23, 25, 9, 25, 4, 16)
  $eye.CloseFigure()
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::Black), 2.4
  $graphics.DrawPath($pen, $eye)
  $graphics.FillEllipse([System.Drawing.Brushes]::Black, 12.5, 12.5, 7, 7)
  $pen.Dispose()
  $eye.Dispose()
  $graphics.Dispose()
  return $bitmap
}

$public = Join-Path $PSScriptRoot '../public'
Write-Ico (Join-Path $public 'logo.ico') @(16, 24, 32, 48, 64, 128, 256)
Copy-Item -LiteralPath (Join-Path $public 'logo.ico') -Destination (Join-Path $public 'favicon.ico') -Force
Write-Icns (Join-Path $public 'logo.icns')
$large = New-AppIcon 512
$large.Save((Join-Path $public 'app-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$large.Dispose()
foreach ($entry in @(@('tray-mac@1x.png', 16), @('tray-mac@2x.png', 32), @('tray-mac@3x.png', 48))) {
  $trayBitmap = New-TrayTemplate $entry[1]
  $trayBitmap.Save((Join-Path $public $entry[0]), [System.Drawing.Imaging.ImageFormat]::Png)
  $trayBitmap.Dispose()
}
