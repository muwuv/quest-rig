<#
Captures a window by title without stealing focus first, so apps that
minimize on focus loss (like Canvid) can still be shot. Restores the window
only if it is already minimized, then tries PrintWindow. If the top window
is capture-protected (WDA_EXCLUDEFROMCAPTURE), unprotected child windows
are captured and stitched onto a canvas instead.

  powershell -File scripts/shot-window.ps1
  powershell -File scripts/shot-window.ps1 -Title "Canvid" -OutDir "$env:USERPROFILE\Desktop"
#>
param(
  [string]$Title = "Canvid",
  [string]$OutDir = ""
)

if (-not $OutDir) {
  # real desktop (respects OneDrive redirection, unlike $env:USERPROFILE\Desktop)
  $OutDir = [Environment]::GetFolderPath("Desktop")
  if (-not $OutDir) { $OutDir = Join-Path $env:USERPROFILE "Desktop" }
}

Add-Type @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hdc, int x, int y, int w, int h, IntPtr hdcSrc, int sx, int sy, int rop);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  const int SRCCOPY = 0x00CC0020;
  const int SW_RESTORE = 9;
  public static void EnsureVisible(IntPtr hwnd) {
    if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
  }
  public static uint Affinity(IntPtr hwnd) {
    try {
      uint a = 0;
      return GetWindowDisplayAffinity(hwnd, out a) != 0 ? a : 0;
    } catch { return 0; }
  }
  public static Bitmap PrintCap(IntPtr hwnd, uint flags) {
    RECT r;
    GetWindowRect(hwnd, out r);
    int w = r.R - r.L, h = r.B - r.T;
    if (w <= 0 || h <= 0) return null;
    var bmp = new Bitmap(w, h);
    using (var g = Graphics.FromImage(bmp)) {
      IntPtr hdc = g.GetHdc();
      bool ok = PrintWindow(hwnd, hdc, flags);
      g.ReleaseHdc(hdc);
      if (!ok) { bmp.Dispose(); return null; }
    }
    return bmp;
  }
  public static Bitmap ScreenCap(IntPtr hwnd) {
    RECT r;
    GetWindowRect(hwnd, out r);
    int w = r.R - r.L, h = r.B - r.T;
    if (w <= 0 || h <= 0) return null;
    var bmp = new Bitmap(w, h);
    using (var g = Graphics.FromImage(bmp)) {
      IntPtr hdc = g.GetHdc();
      IntPtr src = GetDC(IntPtr.Zero);
      BitBlt(hdc, 0, 0, w, h, src, r.L, r.T, SRCCOPY);
      ReleaseDC(IntPtr.Zero, src);
      g.ReleaseHdc(hdc);
    }
    return bmp;
  }
  public static bool IsBlank(Bitmap bmp) {
    int distinct = 0;
    int last = -1;
    for (int y = 0; y < bmp.Height; y += 8) {
      for (int x = 0; x < bmp.Width; x += 8) {
        int c = bmp.GetPixel(x, y).ToArgb() & 0xFFFFFF;
        if (c != last) { distinct++; last = c; }
        if (distinct > 8) return false;
      }
    }
    return true;
  }
}
"@ -ReferencedAssemblies System.Drawing

$proc = Get-Process |
  Where-Object { $_.MainWindowTitle -like "*$Title*" } |
  Select-Object -First 1

if (-not $proc) {
  Write-Error "no visible window matching '$Title'"
  exit 1
}

$hwnd = $proc.MainWindowHandle
Write-Host "window: '$($proc.MainWindowTitle)' minimized=$([WinCap]::IsIconic($hwnd))"

$aff = [WinCap]::Affinity($hwnd)
if ($aff -ne 0) {
  Write-Host "top window is capture-protected (affinity=$aff), capturing child windows instead"
}

function Get-Shot([IntPtr]$h) {
  foreach ($flags in @(2, 0)) {
    $c = [WinCap]::PrintCap($h, $flags)
    if ($c -and -not [WinCap]::IsBlank($c)) { return $c }
    if ($c) { $c.Dispose() }
  }
  return $null
}

function Get-Children([IntPtr]$h) {
  $out = @()
  $ch = [WinCap]::GetWindow($h, 5)
  while ($ch -ne [IntPtr]::Zero) {
    $out += $ch
    $ch = [WinCap]::GetWindow($ch, 2)
  }
  return $out
}

# win the race: restore if needed, then grab immediately in a tight loop
[WinCap]::EnsureVisible($hwnd)
$bmp = $null
for ($i = 0; $i -lt 25 -and -not $bmp; $i++) {
  if ([WinCap]::IsIconic($hwnd)) {
    [WinCap]::EnsureVisible($hwnd)
    Start-Sleep -Milliseconds 80
    continue
  }
  $bmp = Get-Shot $hwnd
  if (-not $bmp) { Start-Sleep -Milliseconds 80 }
}
if (-not $bmp) {
  # protected parent: stitch unprotected children onto a canvas
  $pr = New-Object WinCap+RECT
  [WinCap]::GetWindowRect($hwnd, [ref]$pr) | Out-Null
  $pw = $pr.R - $pr.L
  $ph = $pr.B - $pr.T
  if ($pw -gt 0 -and $ph -gt 0) {
    $canvas = New-Object System.Drawing.Bitmap($pw, $ph)
    $hit = $false
    foreach ($ch in (Get-Children $hwnd)) {
      $aff2 = [WinCap]::Affinity($ch)
      if ($aff2 -ne 0) { continue }
      $cr = New-Object WinCap+RECT
      [WinCap]::GetWindowRect($ch, [ref]$cr) | Out-Null
      $cw = $cr.R - $cr.L
      $chh = $cr.B - $cr.T
      if ($cw -lt 50 -or $chh -lt 50) { continue }
      $part = Get-Shot $ch
      if ($part) {
        $g = [System.Drawing.Graphics]::FromImage($canvas)
        $g.DrawImage($part, ($cr.L - $pr.L), ($cr.T - $pr.T))
        $g.Dispose()
        $part.Dispose()
        $hit = $true
      }
    }
    if ($hit) { $bmp = $canvas } else { $canvas.Dispose() }
  }
}
if (-not $bmp) {
  $bmp = [WinCap]::ScreenCap($hwnd)
  if ($bmp -and [WinCap]::IsBlank($bmp)) { $bmp.Dispose(); $bmp = $null }
}
if (-not $bmp) {
  Write-Error "capture failed for '$($proc.MainWindowTitle)'"
  exit 1
}

mkdir $OutDir -Force | Out-Null
$path = Join-Path $OutDir ("{0}_{1:yyyyMMdd_HHmmss}.png" -f ($proc.ProcessName, (Get-Date)))
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output $path
