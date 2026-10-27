[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Catalog = Join-Path $Root 'src\data\catalog.json'
$Output = Join-Path $Root 'images\products'

if (-not (Test-Path -LiteralPath $Catalog -PathType Leaf)) {
    Write-Error "Catalog file not found: $Catalog"
    exit 1
}

New-Item -ItemType Directory -Path $Output -Force | Out-Null

$catalogItems = Get-Content -LiteralPath $Catalog -Raw | ConvertFrom-Json
$count = 0
$failed = 0
$seen = @{}
$imageNumbers = @{}

foreach ($item in $catalogItems) {
    foreach ($variant in @($item.v)) {
        $sku = [string]$variant.k
        if (-not $imageNumbers.ContainsKey($sku.ToLowerInvariant())) {
            $imageNumbers[$sku.ToLowerInvariant()] = 1
        }
        $imageNumber = $imageNumbers[$sku.ToLowerInvariant()]

        foreach ($urlValue in @($variant.ex)) {
            if ([string]::IsNullOrWhiteSpace($sku) -or [string]::IsNullOrWhiteSpace([string]$urlValue)) {
                continue
            }

            $url = [string]$urlValue
            $key = $sku.ToLowerInvariant() + "`t" + $url
            if ($seen.ContainsKey($key)) {
                continue
            }
            $seen[$key] = $true

            $safeSku = $sku.ToLowerInvariant() -replace '[^a-z0-9._-]', '-'
            $safeSku = $safeSku.Trim('-')
            if ([string]::IsNullOrWhiteSpace($safeSku)) {
                Write-Warning "Skipping empty or invalid SKU: $sku"
                continue
            }

            $productDir = Join-Path $Output $safeSku
            New-Item -ItemType Directory -Path $productDir -Force | Out-Null

            $existing = Get-ChildItem -LiteralPath $productDir -File -Filter "$imageNumber.*" -ErrorAction SilentlyContinue
            if (-not $Force -and $existing) {
                Write-Host "Skip existing image: $safeSku/$imageNumber.* (use -Force to replace)"
                $imageNumbers[$sku.ToLowerInvariant()] = $imageNumbers[$sku.ToLowerInvariant()] + 1
                continue
            }

            $candidates = @(
                $url -replace '/nb300/', '/nb1280/'
                $url -replace '/nb300/', '/nb640/'
                $url
            ) | Select-Object -Unique

            $downloaded = $false
            foreach ($candidate in $candidates) {
                $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ("mobile-joe-" + [guid]::NewGuid().ToString() + ".tmp")
                try {
                    Invoke-WebRequest -Uri $candidate -OutFile $tempFile -UseBasicParsing `
                        -MaximumRedirection 10 -TimeoutSec 90 `
                        -UserAgent 'MobileJoeCatalogImageDownloader/1.0'

                    $extension = $null
                    if (Test-Path -LiteralPath $tempFile -PathType Leaf) {
                        $bytes = [System.IO.File]::ReadAllBytes($tempFile)
                        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xff -and $bytes[1] -eq 0xd8 -and $bytes[2] -eq 0xff) {
                            $extension = 'jpg'
                        }
                        elseif ($bytes.Length -ge 8 -and
                            $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50 -and $bytes[2] -eq 0x4e -and $bytes[3] -eq 0x47 -and
                            $bytes[4] -eq 0x0d -and $bytes[5] -eq 0x0a -and $bytes[6] -eq 0x1a -and $bytes[7] -eq 0x0a) {
                            $extension = 'png'
                        }
                        elseif ($bytes.Length -ge 12 -and
                            [System.Text.Encoding]::ASCII.GetString($bytes, 0, 4) -eq 'RIFF' -and
                            [System.Text.Encoding]::ASCII.GetString($bytes, 8, 4) -eq 'WEBP') {
                            $extension = 'webp'
                        }
                        elseif ($bytes.Length -ge 12 -and
                            [System.Text.Encoding]::ASCII.GetString($bytes, 4, 8) -eq 'ftypavif') {
                            $extension = 'avif'
                        }
                        elseif ($bytes.Length -ge 12 -and
                            [System.Text.Encoding]::ASCII.GetString($bytes, 4, 4) -eq 'ftyp' -and
                            [System.Text.Encoding]::ASCII.GetString($bytes, 8, 4) -in @('avif', 'avis')) {
                            $extension = 'avif'
                        }
                    }

                    if ($extension -and $bytes.Length -gt 0) {
                        $destination = Join-Path $productDir "$imageNumber.$extension"
                        Get-ChildItem -LiteralPath $productDir -File -Filter "$imageNumber.*" -ErrorAction SilentlyContinue |
                            Remove-Item -Force
                        Move-Item -LiteralPath $tempFile -Destination $destination -Force
                        Write-Host "Downloaded $safeSku/$imageNumber.$extension"
                        $count++
                        $downloaded = $true
                        $imageNumbers[$sku.ToLowerInvariant()] = $imageNumbers[$sku.ToLowerInvariant()] + 1
                        break
                    }
                }
                catch {
                    Write-Verbose ("Download failed for ${candidate}: " + $($_.Exception.Message))
                }
                finally {
                    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
                }
            }

            if (-not $downloaded) {
                Write-Warning ("Failed to download image $imageNumber for SKU ${sku}: ${url}")
                $failed++
                $imageNumbers[$sku.ToLowerInvariant()] = $imageNumbers[$sku.ToLowerInvariant()] + 1
            }
        }
    }
}

Write-Host "`nFinished: $count downloaded, $failed failed."
if ($failed -gt 0) {
    exit 1
}
