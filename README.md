# Data Garden

Live crypto prices rendered as a physics-driven 3D "garden" — glowing planet-spheres
drift, orbit and rise/fall with the market. Warm amber and copper tones, soft fog
and dust — not a neon dashboard.

![screenshot placeholder](docs/screenshot.png)

## What it does

- Six coins (BTC, ETH, SOL, DOGE, XRP, ADA) pulled from Binance's public
  `ticker/24hr` endpoint every ~12 seconds — no API key needed.
- Each coin is a glowing sphere:
  - **size** maps to 24h quote volume
  - **height** maps to 24h % change (up rises, down sinks)
  - **colour** — warm amber for up, cool slate for down
- Hand-rolled spring physics: gentle attraction to an "anchor height", damping,
  slight mutual repulsion so spheres never overlap, and small momentum drift.
- OrbitControls: drag to rotate, wheel to zoom.
- HUD top-left: app name, connection status, last update time. If a poll fails
  or Binance rate-limits us, the HUD flips to "reconnecting…" and we keep the
  last good data on screen.

## Build

Requires .NET 8 SDK on Windows (WebView2 is WinForms/WPF only).

```
dotnet publish DataGarden -c Release -r win-x64 --self-contained false
```

Or just grab the latest `DataGarden-windows.zip` from the
[releases page](https://github.com/ByTheSeaL/data-garden/releases) — unzip and run
`DataGarden.exe`.

## Layout

```
DataGarden.sln
DataGarden/
  Program.cs        WinForms shell + WebView2 host + Binance poller
  www/              served to WebView2 via virtual host app.local
    index.html
    main.js         Three.js scene, physics, labels
    style.css
    three/          three.module.min.js (r160, bundled — works offline)
    three/addons/   OrbitControls.js (bundled)
```