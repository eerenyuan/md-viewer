Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# rounded-rect background
$bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 31, 111, 235))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 48
$rect = New-Object System.Drawing.Rectangle(8, 8, 240, 240)
[void]$path.AddArc($rect.X, $rect.Y, $r, $r, 180, 90)
[void]$path.AddArc($rect.Right - $r, $rect.Y, $r, $r, 270, 90)
[void]$path.AddArc($rect.Right - $r, $rect.Bottom - $r, $r, $r, 0, 90)
[void]$path.AddArc($rect.X, $rect.Bottom - $r, $r, $r, 90, 90)
[void]$path.CloseFigure()
$g.FillPath($bg, $path)

# "M" glyph
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Segoe UI', 130, [System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF(0, -8, 256, 256)
$g.DrawString('M', $font, $white, $textRect, $fmt)

New-Item -ItemType Directory -Force -Path build | Out-Null
$bmp.Save('build/icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "icon saved: build/icon.png ($((Get-Item build/icon.png).Length) bytes)"
