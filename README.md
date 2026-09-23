# play_music_theory (Self-Hosted Edition)

A self-hosted, offline-capable visual music synthesizer and sequencer. Enables drawing melodic loops, harmonic exploration, and piece sharing with unlocked instrument controls and a standalone backend.

---

## Overview

play_music_theory is a browser-based visual instrument designed to explore the relationship between sound, geometry, and time. Each color corresponds to a dedicated acoustic or electronic voice, mapped across a two-dimensional timeline and pitch canvas.

This self-hosted edition provides a complete, standalone implementation:
- **Unlocked Synthesizer Parameters**: Full access to musical modes, micro-tuning, swing quantization, octave transposition, custom pitch sets, and audio export.
- **Embedded Python Server (`server.py`)**: Multi-threaded HTTP backend with zero third-party dependencies, implementing routing, static file delivery, and community data endpoints.
- **Local Persistence & Gallery**: Offline database (`gallery-data.json`) containing 72 community compositions, with local piece publication and optional upstream synchronization.
- **Offline PWA Architecture**: Progressive Web App capabilities via Service Worker caching (`sw.js`) and Web Audio API synthesis.

---

## Features

- **Synthesizer Engine**:
  - Musical scales: Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Blues, Harmonic Minor, Pentatonic, and custom chromatic pitch classes.
  - Performance controls: Adjustable tempo (60–200 BPM), swing timing, octave shift (-2 to +2), pitch range, and reference tuning (432 Hz, 440 Hz, custom).
- **Interface Design**:
  - Ergonomic control layout structured after hardware synthesizers.
  - Tactile control surfaces, LED state indicators, calibrated faders, and accessible interaction models.
- **Community Gallery & Local Publication**:
  - Bundled archive of 72 pieces ready for immediate playback and inspection.
  - Local piece creation: vector stroke data is packed, indexed, and stored in `gallery-data.json`.
  - Non-blocking upstream dispatch to the public registry when network connectivity is available.
- **Progressive Web App (PWA)**:
  - Installable across desktop and mobile operating systems.
  - Complete offline operability without network requirements.
- **Vector Assets**:
  - Modular 512x512 SVG application icon aligned to the 9-voice sound matrix, compliant with standard and maskable icon specifications.

---

## Quick Start

### Prerequisites
- Python 3.8 or newer (uses Python standard library only).
- Modern web browser with Web Audio API support (Chromium, Firefox, WebKit).

### Installation and Execution

1. Clone the repository:
   ```bash
   git clone https://github.com/<your-username>/play-music-theory.git
   cd play-music-theory
   ```

2. Start the HTTP server:
   ```bash
   python3 server.py 8000
   ```

3. Access the application:
   - Instrument: `http://localhost:8000/play` (or `http://localhost:8000/`)
   - Gallery: `http://localhost:8000/gallery`

The listening port can be customized via command-line argument (`python3 server.py <port>`) or the `PORT` environment variable.

---

## Repository Structure

```
├── index.html            # Core synthesizer engine, canvas renderer, and UI
├── gallery.html          # Interactive composition browser and viewer
├── gallery-data.json     # Local composition database
├── server.py             # Multi-threaded Python HTTP server
├── sw.js                 # Service Worker offline asset cache
├── remux.js              # MP4/AAC container remuxer for recording exports
├── icon.svg              # Scalable vector application icon
├── manifest.webmanifest  # Progressive Web App configuration manifest
└── assets/               # Texture and acoustic visual assets (0.jpg - 8.jpg)
```

---

## Server API Reference

The server (`server.py`) provides the following endpoints:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` or `/play` | Serves the main instrument player interface |
| `GET` | `/gallery` | Serves the community composition gallery |
| `GET` | `/gallery-data` | Returns published composition data (JSON) |
| `POST` | `/publish` | Receives and stores new composition payloads |
| `GET` | `/gallery-feature` | Toggles featured status for specified item ID |
| `GET` | `/gallery-approve` | Approves pending items in review queue |
| `GET` | `/gallery-remove` | Removes composition by ID |
| `POST` | `/gallery-triage` | Batch processes keep/drop triage lists |

Static files are served directly with appropriate MIME types and permissive CORS headers for local development.

---

## Credits and Attribution

- **Original Concept and Design**: Created by Tala Rae Schlossberg ([talaschlossberg.com](https://talaschlossberg.com) / [playmusictheory.net](https://playmusictheory.net)).
- **Disclaimer**: This is an independent open-source modification developed for educational and self-hosting purposes. Original artistic concepts and audiovisual assets remain the property of their creator.

---

## License

Custom backend implementations, configuration, and interface modifications are distributed under the MIT License. See [LICENSE](LICENSE) for details.
