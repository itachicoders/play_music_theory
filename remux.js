// Defragmenter for the takes: Chrome's MediaRecorder writes fragmented
// MP4 (ftyp + empty moov + moof/mdat pairs), which Instagram's importer
// refuses even though every player handles it. This rebuilds the exact
// same encoded samples as a flat, classic MP4: ftyp + mdat + a moov with
// real sample tables. Input is constrained to what MediaRecorder emits
// (one avc1 video track, one mp4a audio track, default-base-is-moof
// fragments), which keeps this small and honest. On any surprise it
// throws, and the caller falls back to the original file.
(function () {
  'use strict';

  function reader(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    return { u8, dv };
  }
  function boxes(r, start, end) {
    const out = [];
    let i = start;
    while (i + 8 <= end) {
      let size = r.dv.getUint32(i);
      const type = String.fromCharCode(r.u8[i + 4], r.u8[i + 5], r.u8[i + 6], r.u8[i + 7]);
      if (size === 1) throw new Error('64-bit box');
      if (size === 0) size = end - i;
      if (size < 8 || i + size > end) throw new Error('bad box ' + type);
      out.push({ type, start: i, size, body: i + 8 });
      i += size;
    }
    return out;
  }
  const find = (list, type) => list.filter((b) => b.type === type);
  const one = (list, type) => {
    const f = find(list, type);
    if (f.length !== 1) throw new Error(type + ' x' + f.length);
    return f[0];
  };

  window.remuxFlat = async function (blob) {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const r = reader(u8);
    const top = boxes(r, 0, u8.length);

    const ftyp = one(top, 'ftyp');
    const moov = one(top, 'moov');
    const moovKids = boxes(r, moov.body, moov.start + moov.size);
    const mvhd = one(moovKids, 'mvhd');
    const traks = find(moovKids, 'trak');
    if (!traks.length || traks.length > 2) throw new Error('traks ' + traks.length);

    // Track templates: id, timescale, and where the stbl lives.
    const tracks = traks.map((trak) => {
      const kids = boxes(r, trak.body, trak.start + trak.size);
      const tkhd = one(kids, 'tkhd');
      const mdia = one(kids, 'mdia');
      const mdiaKids = boxes(r, mdia.body, mdia.start + mdia.size);
      const mdhd = one(mdiaKids, 'mdhd');
      const minf = one(mdiaKids, 'minf');
      const minfKids = boxes(r, minf.body, minf.start + minf.size);
      const stbl = one(minfKids, 'stbl');
      const stblKids = boxes(r, stbl.body, stbl.start + stbl.size);
      const stsd = one(stblKids, 'stsd');
      const tkhdVer = r.u8[tkhd.body];
      const id = r.dv.getUint32(tkhd.body + (tkhdVer === 1 ? 20 : 12));
      const mdhdVer = r.u8[mdhd.body];
      const timescale = r.dv.getUint32(mdhd.body + (mdhdVer === 1 ? 20 : 12));
      const hdlr = one(mdiaKids, 'hdlr');
      const handler = String.fromCharCode(r.u8[hdlr.body + 8], r.u8[hdlr.body + 9], r.u8[hdlr.body + 10], r.u8[hdlr.body + 11]);
      return { trak, tkhd, tkhdVer, mdhd, mdhdVer, mdia, minf, stbl, stsd, id, timescale, handler,
               samples: [], data: [], bytes: 0 };
    });
    const byId = {};
    for (const t of tracks) byId[t.id] = t;

    // Fragment defaults (trex), if present.
    const trexDefaults = {};
    for (const mvex of find(moovKids, 'mvex')) {
      for (const trex of find(boxes(r, mvex.body, mvex.start + mvex.size), 'trex')) {
        const id = r.dv.getUint32(trex.body + 4);
        trexDefaults[id] = {
          duration: r.dv.getUint32(trex.body + 12),
          size: r.dv.getUint32(trex.body + 16),
          flags: r.dv.getUint32(trex.body + 20),
        };
      }
    }

    // Walk the fragments, collecting every sample per track.
    for (const moof of find(top, 'moof')) {
      const moofKids = boxes(r, moof.body, moof.start + moof.size);
      for (const traf of find(moofKids, 'traf')) {
        const trafKids = boxes(r, traf.body, traf.start + traf.size);
        const tfhd = one(trafKids, 'tfhd');
        const tfFlags = r.dv.getUint32(tfhd.body) & 0xFFFFFF;
        let o = tfhd.body + 4;
        const trackId = r.dv.getUint32(o); o += 4;
        const track = byId[trackId];
        if (!track) throw new Error('traf for unknown track');
        if (tfFlags & 0x1) throw new Error('base-data-offset'); // Chrome uses default-base-is-moof
        if (tfFlags & 0x2) o += 4;
        const defDur = (tfFlags & 0x8) ? r.dv.getUint32((o += 4) - 4) : (trexDefaults[trackId] || {}).duration;
        const defSize = (tfFlags & 0x10) ? r.dv.getUint32((o += 4) - 4) : (trexDefaults[trackId] || {}).size;
        const defFlags = (tfFlags & 0x20) ? r.dv.getUint32((o += 4) - 4) : (trexDefaults[trackId] || {}).flags;

        for (const trun of find(trafKids, 'trun')) {
          const trunVer = r.u8[trun.body];
          const flags = r.dv.getUint32(trun.body) & 0xFFFFFF;
          const count = r.dv.getUint32(trun.body + 4);
          let p = trun.body + 8;
          let dataPos = moof.start; // default-base-is-moof
          if (flags & 0x1) { dataPos = moof.start + r.dv.getInt32(p); p += 4; }
          let firstFlags = null;
          if (flags & 0x4) { firstFlags = r.dv.getUint32(p); p += 4; }
          for (let s = 0; s < count; s++) {
            const dur = (flags & 0x100) ? r.dv.getUint32((p += 4) - 4) : defDur;
            const size = (flags & 0x200) ? r.dv.getUint32((p += 4) - 4) : defSize;
            let sflags = (flags & 0x400) ? r.dv.getUint32((p += 4) - 4)
              : (s === 0 && firstFlags !== null ? firstFlags : defFlags);
            let cts = 0;
            if (flags & 0x800) { cts = trunVer === 0 ? r.dv.getUint32((p += 4) - 4) : r.dv.getInt32((p += 4) - 4); }
            if (dur === undefined || size === undefined) throw new Error('sample without size/duration');
            const sync = sflags === undefined ? true : ((sflags >> 16) & 0x1) === 0; // sample_is_non_sync_sample
            track.samples.push({ dur, size, sync, cts });
            track.data.push(u8.subarray(dataPos, dataPos + size));
            track.bytes += size;
            dataPos += size;
          }
        }
      }
    }
    for (const t of tracks) if (!t.samples.length) throw new Error('empty track');

    // ---- Serialize: faststart order (ftyp, moov, mdat). Instagram
    // reads shared files as a stream and never finds a trailing index,
    // so the index leads and the data follows. ----
    const u32 = (v) => new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
    const box = (type, ...parts) => {
      let size = 8;
      for (const part of parts) size += part.length;
      const head = new Uint8Array(8);
      new DataView(head.buffer).setUint32(0, size);
      for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
      const out = new Uint8Array(size);
      out.set(head, 0);
      let at = 8;
      for (const part of parts) { out.set(part, at); at += part.length; }
      return out;
    };
    const full = (type, version, flags, ...parts) => {
      const vf = new Uint8Array(4);
      vf[0] = version; vf[1] = (flags >> 16) & 255; vf[2] = (flags >> 8) & 255; vf[3] = flags & 255;
      return box(type, vf, ...parts);
    };

    // Where each track's one chunk sits inside the sample data area.
    let rel = 0;
    for (const t of tracks) { t.relOffset = rel; rel += t.bytes; }

    const movieTimescale = r.dv.getUint32(mvhd.body + (r.u8[mvhd.body] === 1 ? 20 : 12));
    let movieDur = 0;

    // Per-track static tables; only stco depends on the final layout.
    for (const t of tracks) {
      const total = t.samples.reduce((n, s) => n + s.dur, 0);
      const inMovie = Math.round(total * movieTimescale / t.timescale);
      if (inMovie > movieDur) movieDur = inMovie;
      t.durTrack = total; t.durMovie = inMovie;

      const runs = [];
      for (const s of t.samples) {
        const last = runs[runs.length - 1];
        if (last && last[1] === s.dur) last[0]++;
        else runs.push([1, s.dur]);
      }
      let body = new Uint8Array(4 + runs.length * 8);
      let dv = new DataView(body.buffer);
      dv.setUint32(0, runs.length);
      runs.forEach((run, i) => { dv.setUint32(4 + i * 8, run[0]); dv.setUint32(8 + i * 8, run[1]); });
      t.stts = full('stts', 0, 0, body);

      t.ctts = null;
      if (t.samples.some((s) => s.cts !== 0)) {
        // Version 0 only (Android refuses v1), offsets lifted to be
        // non-negative; a lift is a constant shift of at most a frame
        // or two, below hearing.
        const minCts = Math.min(...t.samples.map((s) => s.cts), 0);
        const cruns = [];
        for (const s of t.samples) {
          const v = s.cts - minCts;
          const last = cruns[cruns.length - 1];
          if (last && last[1] === v) last[0]++;
          else cruns.push([1, v]);
        }
        body = new Uint8Array(4 + cruns.length * 8);
        dv = new DataView(body.buffer);
        dv.setUint32(0, cruns.length);
        cruns.forEach((run, i) => { dv.setUint32(4 + i * 8, run[0]); dv.setUint32(8 + i * 8, run[1]); });
        t.ctts = full('ctts', 0, 0, body);
      }

      t.stss = null;
      if (!t.samples.every((s) => s.sync)) {
        const keys = [];
        t.samples.forEach((s, i) => { if (s.sync) keys.push(i + 1); });
        if (!keys.length) throw new Error('no sync samples');
        body = new Uint8Array(4 + keys.length * 4);
        dv = new DataView(body.buffer);
        dv.setUint32(0, keys.length);
        keys.forEach((k, i) => dv.setUint32(4 + i * 4, k));
        t.stss = full('stss', 0, 0, body);
      }

      body = new Uint8Array(4 + 12);
      dv = new DataView(body.buffer);
      dv.setUint32(0, 1); dv.setUint32(4, 1); dv.setUint32(8, t.samples.length); dv.setUint32(12, 1);
      t.stsc = full('stsc', 0, 0, body);

      body = new Uint8Array(8 + t.samples.length * 4);
      dv = new DataView(body.buffer);
      dv.setUint32(0, 0); dv.setUint32(4, t.samples.length);
      t.samples.forEach((s, i) => dv.setUint32(8 + i * 4, s.size));
      t.stsz = full('stsz', 0, 0, body);
    }

    // The trak (and so the moov) has a fixed size whatever the offsets
    // are: build once with zeros to measure, again with the real bases.
    const buildTrak = (t, chunkOffset) => {
      const body = new Uint8Array(8);
      const dv = new DataView(body.buffer);
      dv.setUint32(0, 1); dv.setUint32(4, chunkOffset);
      const stco = full('stco', 0, 0, body);
      const stsdBytes = u8.subarray(t.stsd.start, t.stsd.start + t.stsd.size);
      const parts = [stsdBytes, t.stts];
      if (t.ctts) parts.push(t.ctts);
      if (t.stss) parts.push(t.stss);
      parts.push(t.stsc, t.stsz, stco);
      const stblNew = box('stbl', ...parts);

      const patched = new Uint8Array(u8.subarray(t.trak.start, t.trak.start + t.trak.size));
      const tkOff = t.tkhd.start - t.trak.start;
      const tkDV = new DataView(patched.buffer, tkOff);
      if (t.tkhdVer === 1) { tkDV.setUint32(8 + 28, 0); tkDV.setUint32(8 + 32, t.durMovie); }
      else tkDV.setUint32(8 + 20, t.durMovie);
      const mdOff = t.mdhd.start - t.trak.start;
      const mdDV = new DataView(patched.buffer, mdOff);
      if (t.mdhdVer === 1) { mdDV.setUint32(8 + 24, 0); mdDV.setUint32(8 + 28, t.durTrack); }
      else mdDV.setUint32(8 + 16, t.durTrack);

      const before = patched.subarray(0, t.stbl.start - t.trak.start);
      const after = patched.subarray(t.stbl.start - t.trak.start + t.stbl.size);
      const inner = new Uint8Array(before.length - 8 + stblNew.length + after.length);
      inner.set(before.subarray(8), 0);
      inner.set(stblNew, before.length - 8);
      inner.set(after, before.length - 8 + stblNew.length);
      const delta = stblNew.length - t.stbl.size;
      const innerDV = new DataView(inner.buffer);
      for (const anc of [t.mdia, t.minf]) {
        innerDV.setUint32(anc.start - t.trak.start - 8, anc.size + delta);
      }
      return box('trak', inner);
    };

    const mvhdBytes = new Uint8Array(u8.subarray(mvhd.start, mvhd.start + mvhd.size));
    const mvhdDV = new DataView(mvhdBytes.buffer);
    if (r.u8[mvhd.body] === 1) { mvhdDV.setUint32(8 + 24, 0); mvhdDV.setUint32(8 + 28, movieDur); }
    else mvhdDV.setUint32(8 + 16, movieDur);

    const buildMoov = (base) => box('moov', mvhdBytes, ...tracks.map((t) => buildTrak(t, base + t.relOffset)));
    const moovSize = buildMoov(0).length;
    const dataBase = ftyp.size + moovSize + 8; // mdat header follows moov
    const moovNew = buildMoov(dataBase);
    if (moovNew.length !== moovSize) throw new Error('moov size shifted');

    const mdatSize = 8 + tracks.reduce((n, t) => n + t.bytes, 0);
    const mdatHead = new Uint8Array(8);
    new DataView(mdatHead.buffer).setUint32(0, mdatSize);
    mdatHead[4] = 109; mdatHead[5] = 100; mdatHead[6] = 97; mdatHead[7] = 116;

    const chunks = [u8.subarray(ftyp.start, ftyp.start + ftyp.size), moovNew, mdatHead];
    for (const t of tracks) for (const d of t.data) chunks.push(d);

    const out = new Blob(chunks, { type: 'video/mp4' });
    if (out.size < blob.size * 0.9) throw new Error('lost data');
    return out;
  };
})();
