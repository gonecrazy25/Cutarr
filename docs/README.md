# Cutarr

Cutarr is a self-hosted Docker web app for splitting multi-episode TV recordings, combined TV files, and DVD rips into separate episode files.

It is designed for MKV/MP4 TV recordings where one video file contains multiple episodes, intros, titles, credits, or extra sections that need to be split out cleanly.

Cutarr runs in a browser, uses FFmpeg in the container, and can access media files mounted from the host.

## Features

- Web-based video splitter
- Docker / Docker Compose install
- Host media folder browsing
- Waveform display with caching
- Click-to-split workflow
- Previous / next split point buttons
- Delete selected split point
- Frame forward / frame backward buttons
- Auto Detect
- Black frame detection
- Silence detection
- Titles / Credits region labeling
- Region include/exclude checkboxes
- Preview output names
- Auto episode numbering
- Split now or queue jobs for later
- Job queue and progress display
- Fast preview mode without audio
- Optional audio preview mode

## Screenshots

![Cutarr main screen](docs/screenshots/cutarr-main.png)
![Cutarr regions screen](docs/screenshots/cutarr-regions.png)

## How it works

Cutarr scans mounted media files from `/media`, creates browser-friendly previews and waveform cache files in `/cache`, and writes split output files to:

```text
/media/Cutarr_Output
```

The app uses FFmpeg to cut selected regions from the source file.

## Requirements

- Docker
- Docker Compose
- A server or NAS with media files mounted into the container
- Recommended: 4 GB RAM or more
- CPU-only operation is supported

## Docker Compose install

Create a folder for Cutarr:

```bash
mkdir -p ~/cutarr
cd ~/cutarr
```

Create `docker-compose.yml`:

```yaml
services:
  cutarr:
    image: ghcr.io/gonecrazy25/cutarr:latest
    container_name: cutarr
    ports:
      - "8088:8088"
    volumes:
      - /path/to/your/media:/media
      - /path/to/cutarr/config:/config
      - /path/to/cutarr/cache:/cache
    restart: unless-stopped
```

Replace these paths:

```text
/path/to/your/media
/path/to/cutarr/config
/path/to/cutarr/cache
```

Example:

```yaml
services:
  cutarr:
    image: ghcr.io/gonecrazy25/cutarr:latest
    container_name: cutarr
    ports:
      - "8088:8088"
    volumes:
      - /mnt/media:/media
      - /opt/cutarr/config:/config
      - /opt/cutarr/cache:/cache
    restart: unless-stopped
```

Start Cutarr:

```bash
docker compose up -d
```

Open Cutarr in your browser:

```text
http://SERVER-IP:8088
```

On first run, Cutarr will ask you to create the admin password.

## Docker run install

```bash
docker run -d \
  --name cutarr \
  -p 8088:8088 \
  -v /path/to/your/media:/media \
  -v /path/to/cutarr/config:/config \
  -v /path/to/cutarr/cache:/cache \
  --restart unless-stopped \
  ghcr.io/gonecrazy25/cutarr:latest
```

Then open:

```text
http://SERVER-IP:8088
```

## Volume mappings

| Container path | Purpose |
|---|---|
| `/media` | Your mounted TV recordings, videos, and output folder |
| `/config` | Cutarr settings, login password, and configuration files |
| `/cache` | Preview files, waveform cache, and temporary files |

## Ports

| Container port | Purpose |
|---|---|
| `8088` | Cutarr web interface |

## First-run login setup

When Cutarr starts for the first time, it checks for:

```text
/config/auth.json
```

If no admin password exists, Cutarr shows a setup page where you create the password for the `admin` user.

After setup, users must log in before accessing Cutarr.

The admin password can be changed later from:

```text
Settings → Admin Password
```

## Cache cleanup

Cutarr stores browser preview files and waveform cache files in `/cache`.

By default, Cutarr deletes cache files older than:

```text
1 day
```

You can change this in Settings.

## Output files

Split files are written under the mounted media folder:

```text
/media/Cutarr_Output
```

For example:

```text
/media/Cutarr_Output/Show Name - S01E01.mkv
/media/Cutarr_Output/Show Name - S01E02.mkv
```

## Updating

Pull the newest image:

```bash
docker compose pull
docker compose up -d
```

Or, if using `docker run`:

```bash
docker pull ghcr.io/gonecrazy25/cutarr:latest
docker stop cutarr
docker rm cutarr
```

Then run the container again using the same `docker run` command.

## Unraid notes

For Unraid, recommended mappings are:

| Container path | Unraid path example |
|---|---|
| `/media` | `/mnt/user/media` |
| `/config` | `/mnt/user/appdata/cutarr` |
| `/cache` | `/mnt/user/appdata/cutarr/cache` |
| `8088` | `8088` |

Example Unraid-style Docker paths:

```text
/media  → /mnt/user/media
/config → /mnt/user/appdata/cutarr
/cache  → /mnt/user/appdata/cutarr/cache
```

## Troubleshooting

### I cannot see my media files

Make sure the host media path is mounted to `/media`.

Example:

```yaml
volumes:
  - /mnt/media:/media
```

### The browser preview takes a long time to load

Turn on:

```text
Fast preview, no audio
```

This skips audio conversion and can load previews faster.

### Audio does not play

Turn off:

```text
Fast preview, no audio
```

Then reload the video.

### I forgot the admin password

Stop Cutarr, remove the auth file, and restart:

```bash
rm /path/to/cutarr/config/auth.json
docker compose restart
```

On the next load, Cutarr will ask you to create a new admin password.

### Cache is using too much space

Open Settings and lower the cache cleanup time, or manually clear the cache folder:

```bash
rm -rf /path/to/cutarr/cache/*
```

## Security notes

Cutarr is intended for use on a trusted home LAN or behind a secure reverse proxy.

If exposing Cutarr outside your network, use HTTPS and strong authentication at the proxy level.

## License

```text
MIT License
```

## Project status

Cutarr is under active development.
