package game

// sound_manager.ts on sokol_audio (ALSA), plus the van's synthesized engine note from
// systems/car.ts (sawtooth -> 600 Hz low-pass -> gain, both smoothed with the Web Audio
// setTargetAtTime time constant of 0.05 s).
//
// Each HTMLAudioElement of the web build is one voice here: play() restarts it from the
// top, and the seven-element gun-shot pool is a round-robin of seven voices.

import "base:runtime"
import "core:c"
import "core:math"
import "core:os"
import "core:sync"
import "core:encoding/endian"

when ODIN_OS == .Linux {
	foreign import saudio_lib {"../build/libsokol_audio_alsa.a", "system:asound", "system:pthread"}
}

Saudio_Logger :: struct {
	func:      proc "c" (a0: cstring, a1: u32, a2: u32, a3: cstring, a4: u32, a5: cstring, a6: rawptr),
	user_data: rawptr,
}
Saudio_Allocator :: struct {
	alloc_fn:  proc "c" (a0: c.size_t, a1: rawptr) -> rawptr,
	free_fn:   proc "c" (a0: rawptr, a1: rawptr),
	user_data: rawptr,
}
Saudio_Win32 :: struct { device_name: rawptr }
Saudio_N3ds :: struct { queue_count: c.int, interpolation_type: i32, channel_id: c.int }
Saudio_Desc :: struct {
	sample_rate:        c.int,
	num_channels:       c.int,
	buffer_frames:      c.int,
	packet_frames:      c.int,
	num_packets:        c.int,
	stream_cb:          proc "c" (buffer: [^]f32, num_frames: c.int, num_channels: c.int),
	stream_userdata_cb: proc "c" (buffer: [^]f32, num_frames: c.int, num_channels: c.int, user: rawptr),
	user_data:          rawptr,
	win32:              Saudio_Win32,
	n3ds:               Saudio_N3ds,
	allocator:          Saudio_Allocator,
	logger:             Saudio_Logger,
}

@(default_calling_convention = "c", link_prefix = "saudio_")
foreign saudio_lib {
	setup :: proc(desc: ^Saudio_Desc) ---
	shutdown :: proc() ---
	isvalid :: proc() -> bool ---
	sample_rate :: proc() -> c.int ---
}

Sound_Id :: enum u8 { Dry_Fire, Gun_Shot_Silenced, Guard_Choke, Door_Open, Door_Close, Explosion }

Clip :: struct {
	samples: []f32, // mono, at the output rate
}

Voice :: struct {
	clip:    ^Clip,
	pos:     int,
	volume:  f32,
	playing: bool,
}

GUN_SHOT_VOICES :: 7

audio: struct {
	ok:            bool,
	rate:          f64,
	mutex:         sync.Mutex,
	clips:         [Sound_Id]Clip,
	gun_clip:      Clip,
	voices:        [Sound_Id]Voice,
	gun_voices:    [GUN_SHOT_VOICES]Voice,
	gun_index:     int,
	// engine
	engine_on:     bool,
	phase:         f64,
	freq, freq_t:  f64,
	gain, gain_t:  f64,
	z1, z2:        f64, // biquad state (direct form II transposed)
	b0, b1, b2, a1, a2: f64,
}

volume_master :: 1.0

audio_init :: proc() {
	desc := Saudio_Desc{sample_rate = 44100, num_channels = 1, stream_cb = audio_stream}
	setup(&desc)
	if !isvalid() do return
	audio.ok = true
	audio.rate = f64(sample_rate())
	files := [Sound_Id]string{
		.Dry_Fire = "dryfiregun.wav",
		.Gun_Shot_Silenced = "gun_shot_silenced.wav",
		.Guard_Choke = "guard_choke.wav",
		.Door_Open = "door-2-open.wav",
		.Door_Close = "door-3-close.wav",
		.Explosion = "explosion.wav",
	}
	vols := [Sound_Id]f32{.Dry_Fire = 1, .Gun_Shot_Silenced = 1, .Guard_Choke = 1, .Door_Open = 0.2, .Door_Close = 0.2, .Explosion = 1}
	for id in Sound_Id {
		audio.clips[id] = load_wav(files[id])
		audio.voices[id] = {clip = &audio.clips[id], volume = vols[id] * volume_master}
	}
	audio.gun_clip = load_wav("gun_shot.wav")
	for &v in audio.gun_voices do v = {clip = &audio.gun_clip, volume = 0.2 * volume_master}
	// lowpass 600 Hz, Q = 1 dB (the Web Audio BiquadFilterNode default)
	w0 := 2 * math.PI * 600 / audio.rate
	alpha := math.sin(w0) / (2 * math.pow(10, 1.0 / 20))
	cw := math.cos(w0)
	a0 := 1 + alpha
	audio.b0 = (1 - cw) / 2 / a0
	audio.b1 = (1 - cw) / a0
	audio.b2 = (1 - cw) / 2 / a0
	audio.a1 = -2 * cw / a0
	audio.a2 = (1 - alpha) / a0
}

audio_shutdown :: proc() {
	if audio.ok do shutdown()
}

load_wav :: proc(name: string) -> Clip {
	data, err := os.read_entire_file(asset_path(concat2("odin/assets/sound/", name)), context.allocator)
	if err != nil || len(data) < 44 do return {}
	defer delete(data)
	channels := 1
	rate := 44100
	bits := 16
	pcm: []u8
	i := 12
	for i + 8 <= len(data) {
		id := string(data[i:i + 4])
		size := int(endian.unchecked_get_u32le(data[i + 4:]))
		body := data[i + 8:min(len(data), i + 8 + size)]
		if id == "fmt " {
			channels = int(endian.unchecked_get_u16le(body[2:]))
			rate = int(endian.unchecked_get_u32le(body[4:]))
			bits = int(endian.unchecked_get_u16le(body[14:]))
		} else if id == "data" {
			pcm = body
		}
		i += 8 + size + (size & 1)
	}
	bytes := bits / 8
	frames := len(pcm) / (bytes * channels)
	mono := make([]f32, frames, context.temp_allocator)
	for f in 0 ..< frames {
		sum: f32 = 0
		for ch in 0 ..< channels {
			o := (f * channels + ch) * bytes
			if bits == 16 do sum += f32(i16(endian.unchecked_get_u16le(pcm[o:]))) / 32768
			else if bits == 8 do sum += (f32(pcm[o]) - 128) / 128
		}
		mono[f] = sum / f32(channels)
	}
	// resample to the device rate
	ratio := f64(rate) / audio.rate
	n := int(f64(frames) / ratio)
	out := make([]f32, n)
	for k in 0 ..< n {
		src := f64(k) * ratio
		a := int(src)
		t := f32(src - f64(a))
		s0 := mono[min(a, frames - 1)]
		s1 := mono[min(a + 1, frames - 1)]
		out[k] = s0 + (s1 - s0) * t
	}
	return {out}
}

play_sound :: proc(id: Sound_Id) {
	if !audio.ok do return
	sync.mutex_lock(&audio.mutex)
	audio.voices[id].pos = 0
	audio.voices[id].playing = true
	sync.mutex_unlock(&audio.mutex)
}

play_gun_shots :: proc() {
	if !audio.ok do return
	if audio.gun_index >= GUN_SHOT_VOICES do audio.gun_index = 0
	sync.mutex_lock(&audio.mutex)
	v := &audio.gun_voices[audio.gun_index]
	v.pos = 0
	v.playing = true
	sync.mutex_unlock(&audio.mutex)
	audio.gun_index += 1
}

engine_start :: proc() {
	if !audio.ok do return
	sync.mutex_lock(&audio.mutex)
	audio.engine_on = true
	audio.phase = 0
	audio.freq = 45
	audio.freq_t = 45
	audio.gain = 0
	audio.gain_t = 0
	audio.z1 = 0
	audio.z2 = 0
	sync.mutex_unlock(&audio.mutex)
}

engine_update :: proc(speed_ratio: f64) {
	if !audio.ok || !audio.engine_on do return
	sync.mutex_lock(&audio.mutex)
	audio.freq_t = 45 + speed_ratio * 105
	audio.gain_t = (0.05 + speed_ratio * 0.06) * volume_master
	sync.mutex_unlock(&audio.mutex)
}

engine_stop :: proc() {
	if !audio.ok do return
	sync.mutex_lock(&audio.mutex)
	audio.engine_on = false
	sync.mutex_unlock(&audio.mutex)
}

audio_stream :: proc "c" (buffer: [^]f32, num_frames: c.int, num_channels: c.int) {
	context = runtime.default_context()
	n := int(num_frames) * int(num_channels)
	for i in 0 ..< n do buffer[i] = 0
	sync.mutex_lock(&audio.mutex)
	defer sync.mutex_unlock(&audio.mutex)
	mix :: proc "contextless" (v: ^Voice, buffer: [^]f32, frames, channels: int) {
		if !v.playing || v.clip == nil do return
		s := v.clip.samples
		for f in 0 ..< frames {
			if v.pos >= len(s) {
				v.playing = false
				return
			}
			x := s[v.pos] * v.volume
			v.pos += 1
			for ch in 0 ..< channels do buffer[f * channels + ch] += x
		}
	}
	frames := int(num_frames)
	chans := int(num_channels)
	for &v in audio.voices do mix(&v, buffer, frames, chans)
	for &v in audio.gun_voices do mix(&v, buffer, frames, chans)
	if audio.engine_on {
		k := 1 - math.exp(-1 / (audio.rate * 0.05))
		for f in 0 ..< frames {
			audio.freq += (audio.freq_t - audio.freq) * k
			audio.gain += (audio.gain_t - audio.gain) * k
			audio.phase += audio.freq / audio.rate
			audio.phase -= math.floor(audio.phase)
			saw := 2 * audio.phase - 1
			y := audio.b0 * saw + audio.z1
			audio.z1 = audio.b1 * saw - audio.a1 * y + audio.z2
			audio.z2 = audio.b2 * saw - audio.a2 * y
			out := f32(y * audio.gain)
			for ch in 0 ..< chans do buffer[f * chans + ch] += out
		}
	}
	for i in 0 ..< n do buffer[i] = clamp(buffer[i], -1, 1)
}
