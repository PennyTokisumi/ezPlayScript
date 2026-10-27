param(
  [Parameter(Mandatory=$true)][string]$Path,   # input image path
  [string]$Out = "",                            # output JSON path (empty -> stdout)
  [string]$Lang = "zh-Hans-CN",                 # OCR language
  [double]$Scale = 1.0                          # upscale factor before OCR (fixes radical-splitting on small glyphs)
)

# Enable synchronous waiting on WinRT IAsyncOperation from PowerShell.
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $resultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]                     | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]                  | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]            | Out-Null

function Write-Result($obj) {
  $json = $obj | ConvertTo-Json -Depth 6 -Compress
  if ($Out -ne "") {
    # UTF-8 without BOM so Node can JSON.parse directly.
    [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
  } else {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::Out.Write($json)
  }
}

try {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language($Lang)))
  if ($null -eq $engine) { Write-Result @{ error = "no OCR engine for language '$Lang'" }; exit 2 }

  $file    = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $stream  = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])

  $ocrW = [int]$decoder.PixelWidth
  $ocrH = [int]$decoder.PixelHeight

  if ($Scale -gt 1.0) {
    # Upscale via BitmapTransform (no external tools). Larger glyphs -> far fewer radical-split errors.
    $ocrW = [int]([math]::Round($decoder.PixelWidth * $Scale))
    $ocrH = [int]([math]::Round($decoder.PixelHeight * $Scale))
    $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
    $transform.ScaledWidth  = [uint32]$ocrW
    $transform.ScaledHeight = [uint32]$ocrH
    $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Cubic
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync(
      [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
      [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
      $transform,
      [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,
      [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage
    )) ([Windows.Graphics.Imaging.SoftwareBitmap])
  } else {
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  }

  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

  $lines = @()
  foreach ($ln in $result.Lines) {
    $minX = 1e9; $minY = 1e9; $maxX = 0; $maxY = 0
    foreach ($w in $ln.Words) {
      $r = $w.BoundingRect
      if ($r.X -lt $minX) { $minX = $r.X }
      if ($r.Y -lt $minY) { $minY = $r.Y }
      if (($r.X + $r.Width)  -gt $maxX) { $maxX = $r.X + $r.Width }
      if (($r.Y + $r.Height) -gt $maxY) { $maxY = $r.Y + $r.Height }
    }
    $lines += [pscustomobject]@{
      text = $ln.Text
      x = [int]$minX; y = [int]$minY; w = [int]($maxX - $minX); h = [int]($maxY - $minY)
    }
  }

  Write-Result ([pscustomobject]@{
    file   = (Split-Path $Path -Leaf)
    width  = $ocrW
    height = $ocrH
    lines  = $lines
  })
} catch {
  Write-Result @{ error = $_.Exception.Message }
  exit 1
}
