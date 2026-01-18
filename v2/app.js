/***********************
 * CONFIG
 ***********************/
const clientId = "234deb8d8a504bed99fd4d803a89ab76";
const redirectUri = "https://pacman21.github.io/power-hour/v2/callback";

const scopes = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state"
];

/***********************
 * STATE
 ***********************/
let accessToken;
let refreshToken;
let player;
let deviceId;

let playlists = [];
let tracks = [];
let currentIndex = 0;

let countdown = 60;
let countdownInterval;
let advanceTimeout;
let isPaused = false;

/***********************
 * PKCE HELPERS
 ***********************/
function randomString(len) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map(x => chars[x % chars.length])
    .join("");
}

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/***********************
 * LOGIN
 ***********************/
document.getElementById("login").onclick = async () => {
  const verifier = randomString(128);
  localStorage.setItem("verifier", verifier);

  const challenge = base64url(await sha256(verifier));

  const url =
    "https://accounts.spotify.com/authorize" +
    "?response_type=code" +
    "&client_id=" + clientId +
    "&redirect_uri=" + encodeURIComponent(redirectUri) +
    "&scope=" + encodeURIComponent(scopes.join(" ")) +
    "&code_challenge_method=S256" +
    "&code_challenge=" + challenge;

  window.location = url;
};

/***********************
 * HANDLE REDIRECT
 ***********************/
async function handleRedirect() {
  const code = new URLSearchParams(window.location.search).get("code");
  if (!code) return;

  const verifier = localStorage.getItem("verifier");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  });

  const data = await res.json();
  accessToken = data.access_token;
  refreshToken = data.refresh_token;

  localStorage.setItem("spotify_tokens", JSON.stringify(data));
  window.history.replaceState({}, document.title, "/");

  onAuthenticated();
}

handleRedirect();

/***********************
 * LOAD STORED TOKEN
 ***********************/
const stored = localStorage.getItem("spotify_tokens");
if (stored) {
  const data = JSON.parse(stored);
  accessToken = data.access_token;
  refreshToken = data.refresh_token;
  onAuthenticated();
}

/***********************
 * AFTER LOGIN
 ***********************/
async function onAuthenticated() {
  document.getElementById("playlist-container").style.display = "block";
  document.getElementById("play").disabled = false;
  document.getElementById("pause").disabled = false;
  await loadPlaylists();
}

/***********************
 * WEB PLAYBACK SDK
 ***********************/
window.onSpotifyWebPlaybackSDKReady = () => {
  player = new Spotify.Player({
    name: "60s Playlist Player",
    getOAuthToken: cb => cb(accessToken)
  });

  player.addListener("ready", ({ device_id }) => {
    deviceId = device_id;
  });

  player.connect();
};

/***********************
 * LOAD USER PLAYLISTS
 ***********************/
async function loadPlaylists() {
  const select = document.getElementById("playlists");
  select.innerHTML = "";

  let url = "https://api.spotify.com/v1/me/playlists";
  playlists = [];

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    playlists.push(...data.items);
    url = data.next;
  }

  playlists.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
}

/***********************
 * LOAD TRACKS (WITH METADATA)
 ***********************/
async function loadTracks(playlistId) {
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  tracks = [];

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    tracks.push(
      ...data.items
        .map(i => i.track)
        .filter(t => t && t.uri)
    );

    url = data.next;
  }
}

/***********************
 * UPDATE NOW PLAYING UI
 ***********************/
function updateNowPlaying(track) {
  document.getElementById("song-name").innerText = track.name;
  document.getElementById("artist-name").innerText =
    track.artists.map(a => a.name).join(", ");

  const img = track.album.images[0]?.url;
  const art = document.getElementById("album-art");

  if (img) {
    art.src = img;
    art.style.display = "block";
  } else {
    art.style.display = "none";
  }
}

/***********************
 * TIMERS
 ***********************/
function startCountdown() {
  clearInterval(countdownInterval);
  document.getElementById("timer").innerText = countdown;

  countdownInterval = setInterval(() => {
    if (!isPaused && countdown > 0) {
      countdown--;
      document.getElementById("timer").innerText = countdown;
    }
  }, 1000);
}

function scheduleAdvance() {
  clearTimeout(advanceTimeout);
  advanceTimeout = setTimeout(() => {
    currentIndex++;
    playNext();
  }, countdown * 1000);
}

/***********************
 * PLAY LOOP
 ***********************/
async function playNext() {
  if (currentIndex >= tracks.length) return;

  const track = tracks[currentIndex];
  updateNowPlaying(track);

  document.getElementById("counter").innerText = currentIndex + 1;

  countdown = 60;
  isPaused = false;

  await fetch(
    `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        uris: [track.uri],
        position_ms: 60000
      })
    }
  );

  startCountdown();
  scheduleAdvance();
}

/***********************
 * PLAY BUTTON
 ***********************/
document.getElementById("play").onclick = async () => {
  const playlistId = document.getElementById("playlists").value;
  if (!playlistId) return;

  clearInterval(countdownInterval);
  clearTimeout(advanceTimeout);

  currentIndex = 0;
  await loadTracks(playlistId);
  playNext();
};

/***********************
 * PAUSE / RESUME
 ***********************/
document.getElementById("pause").onclick = async () => {
  if (!player) return;

  if (!isPaused) {
    await player.pause();
    clearTimeout(advanceTimeout);
    isPaused = true;
    document.getElementById("pause").innerText = "Resume";
  } else {
    await player.resume();
    isPaused = false;
    scheduleAdvance();
    document.getElementById("pause").innerText = "Pause";
  }
};
