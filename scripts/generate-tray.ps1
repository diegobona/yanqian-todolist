# Vector geometry matches public/tray.svg; supersampling keeps the small icon crisp.
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.ScaleTransform(8,8)
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#173d32'))
$mint = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#b9f3d3'))
$shape = New-Object System.Drawing.Drawing2D.GraphicsPath
$shape.AddArc(1,1,16,16,180,90)
$shape.AddArc(15,1,16,16,270,90)
$shape.AddArc(15,15,16,16,0,90)
$shape.AddArc(1,15,16,16,90,90)
$shape.CloseFigure()
$graphics.FillPath($dark,$shape)
$eye = New-Object System.Drawing.Drawing2D.GraphicsPath
$eye.AddBezier(5,16,10,7,22,7,27,16)
$eye.AddBezier(27,16,22,25,10,25,5,16)
$eye.CloseFigure()
$graphics.FillPath($mint,$eye)
$graphics.FillEllipse($dark,11.5,11.5,9,9)
$graphics.FillEllipse([System.Drawing.Brushes]::White,16.25,13.25,2.5,2.5)
$output = New-Object System.Drawing.Bitmap 32,32
$resize = [System.Drawing.Graphics]::FromImage($output)
$resize.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$resize.DrawImage($bitmap,0,0,32,32)
$output.Save((Join-Path $PSScriptRoot '../public/tray.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$resize.Dispose()
$output.Dispose()
$eye.Dispose()
$shape.Dispose()
$dark.Dispose()
$mint.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
