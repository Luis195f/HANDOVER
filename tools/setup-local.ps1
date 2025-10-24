# === Config ===
$Root = "C:\Users\luism\OneDrive\Escritorio\Nurseos\backend-django"  # <-- AJUSTA ESTA RUTA
Set-Location $Root

# Detectar <PROJECT>
$settings = Get-ChildItem -Recurse -Filter "settings.py" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "\\\.venv\\|\\venv\\|site-packages" } |
  Select-Object -First 1
if (-not $settings) { throw "No encontré settings.py dentro de $Root" }
$PROJECT = $settings.Directory.Name
Write-Host "Proyecto detectado: $PROJECT"

# Verificar Python 3.12
$py = & py -3.12 --version 2>$null
if (-not $py) { throw "Instala Python 3.12 y marca 'Add to PATH'." }

# Crear/activar venv
if (-not (Test-Path ".\.venv")) { & py -3.12 -m venv .venv }
.\.venv\Scripts\Activate.ps1

# pip + dependencias
python -m pip install --upgrade pip
if (Test-Path "requirements.txt") {
  pip install -r requirements.txt
} else {
  'Django>=4.2,<5.1' | Out-File requirements.txt -Encoding utf8
  'gunicorn>=21.2'   | Add-Content requirements.txt
  pip install -r requirements.txt
}

# Migraciones
python manage.py migrate --noinput

# Abrir puerto 8000 si no existe
$ruleName = "Django Dev 8000"
$exists = (netsh advfirewall firewall show rule name="$ruleName" | Select-String -Pattern "$ruleName" -Quiet)
if (-not $exists) {
  netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=8000 | Out-Null
  Write-Host "Regla de firewall creada: $ruleName"
}

# Mostrar IP y arrancar
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch "Loopback|vEthernet" -and $_.IPAddress -notmatch "^169\.254\." } | Select-Object -First 1 -ExpandProperty IPAddress)
Write-Host "Abre en tu móvil (misma Wi-Fi): http://$ip:8000"
Write-Host "Inicio del server..."
python manage.py runserver 0.0.0.0:8000
