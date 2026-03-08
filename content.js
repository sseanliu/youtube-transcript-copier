// This script will be injected into YouTube video pages.
// It will add a "Copy Transcript" button and fetch transcripts via YouTube's innertube API.

function createCopyButton() {
  const button = document.createElement("button");
  button.className = "yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-leading";
  button.style.marginLeft = '8px';
  button.addEventListener('click', onCopyTranscriptClick);

  const iconDiv = document.createElement('div');
  iconDiv.className = 'yt-spec-button-shape-next__icon';
  iconDiv.setAttribute('aria-hidden', 'true');
  const svgIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgIcon.setAttribute('height', '24px');
  svgIcon.setAttribute('viewBox', '0 0 24 24');
  svgIcon.setAttribute('width', '24px');
  svgIcon.setAttribute('focusable', 'false');
  svgIcon.setAttribute('fill', 'none');

  svgIcon.innerHTML = `<path d="M16.5 3H5V17M8 6V21H20V6H8Z" stroke="currentColor" stroke-width="1"/>`;
  iconDiv.appendChild(svgIcon);

  const textDiv = document.createElement('div');
  textDiv.className = 'yt-spec-button-shape-next__button-text-content';
  const textSpan = document.createElement('span');
  textSpan.className = 'yt-core-attributed-string yt-core-attributed-string--white-space-no-wrap';
  textSpan.textContent = "Copy";
  textDiv.appendChild(textSpan);

  button.appendChild(iconDiv);
  button.appendChild(textDiv);

  return button;
}

function addCopyButton() {
  const shareButton = document.querySelector('ytd-menu-renderer button[aria-label="Share"]');
  const existingCopyButton = document.querySelector("#copy-transcript-button");

  if (shareButton && !existingCopyButton) {
    const buttonWrapper = shareButton.closest('yt-button-view-model');
    if (buttonWrapper) {
      const copyButton = createCopyButton();
      copyButton.id = "copy-transcript-button";
      buttonWrapper.parentNode.insertBefore(copyButton, buttonWrapper.nextSibling);
      return true;
    }
  }
  return false;
}

async function onCopyTranscriptClick() {
  const copyButton = document.querySelector("#copy-transcript-button");
  const textSpan = copyButton.querySelector('.yt-core-attributed-string');

  if (!textSpan) return;

  const originalText = textSpan.textContent;
  textSpan.textContent = "Copying...";

  try {
    const transcriptText = await fetchTranscript();
    await navigator.clipboard.writeText(transcriptText);

    textSpan.textContent = "Copied!";
    setTimeout(() => {
      textSpan.textContent = originalText;
    }, 2000);

  } catch (error) {
    console.error("[Transcript Copier] Error:", error);
    alert("Failed to copy transcript: " + error.message);
    textSpan.textContent = originalText;
  }
}

function getVideoId() {
  const url = new URL(window.location.href);
  return url.searchParams.get('v');
}

// Extract a JSON object starting at a given index using brace counting
function extractJsonObject(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.substring(startIndex, i + 1);
    }
  }
  return null;
}

function parsePlayerResponseFromText(text) {
  const marker = 'ytInitialPlayerResponse';
  const idx = text.indexOf(marker);
  if (idx === -1) return null;

  // Find the opening brace after the marker
  const braceIdx = text.indexOf('{', idx + marker.length);
  if (braceIdx === -1) return null;

  const jsonStr = extractJsonObject(text, braceIdx);
  if (!jsonStr) return null;

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn("[Transcript Copier] Failed to parse ytInitialPlayerResponse JSON:", e);
    return null;
  }
}

// Step 1: Get caption track URLs from the page's embedded ytInitialPlayerResponse
async function getCaptionTracks(videoId) {
  // Try to extract from page HTML script tags
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent;
    if (!text || !text.includes('ytInitialPlayerResponse')) continue;

    const playerResponse = parsePlayerResponseFromText(text);
    if (playerResponse) {
      const tracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        console.log("[Transcript Copier] Found caption tracks from ytInitialPlayerResponse");
        return tracks;
      }
    }
  }

  // Fallback: fetch the watch page HTML and parse from there
  console.log("[Transcript Copier] ytInitialPlayerResponse not found in DOM, fetching page...");
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch video page: HTTP ${response.status}`);
  }
  const html = await response.text();
  const playerResponse = parsePlayerResponseFromText(html);
  if (playerResponse) {
    const tracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (tracks && tracks.length > 0) {
      console.log("[Transcript Copier] Found caption tracks from fetched page HTML");
      return tracks;
    }
  }

  throw new Error("This video does not have captions/transcript available.");
}

// Step 2: Fetch the actual caption text from a track URL
async function fetchCaptionTrack(baseUrl) {
  // Append fmt=json3 to get JSON format
  const url = baseUrl + '&fmt=json3';

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Caption track returned HTTP ${response.status}`);
  }

  const data = await response.json();
  return parseCaptionEvents(data.events);
}

function parseCaptionEvents(events) {
  if (!events || events.length === 0) {
    throw new Error("Caption track has no events.");
  }

  let transcript = '';
  for (const event of events) {
    // Skip events without text segments (timing markers, style events)
    if (!event.segs) continue;

    const text = event.segs.map(seg => seg.utf8 || '').join('');
    if (text.trim()) {
      // Replace newlines within a segment with spaces
      transcript += text.replace(/\n/g, ' ').trim() + ' ';
    }
  }

  if (!transcript.trim()) {
    throw new Error("Caption track was empty.");
  }

  return transcript.trim();
}

// Main: fetch transcript for current video
async function fetchTranscript() {
  const videoId = getVideoId();
  if (!videoId) throw new Error("Could not determine video ID.");

  console.log("[Transcript Copier] Fetching captions for video:", videoId);

  const tracks = await getCaptionTracks(videoId);

  // Prefer English, then any non-auto-generated, then any track
  let selectedTrack = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
                      tracks.find(t => t.languageCode === 'en') ||
                      tracks.find(t => t.kind !== 'asr') ||
                      tracks[0];

  console.log("[Transcript Copier] Using track:", selectedTrack.languageCode, selectedTrack.kind || 'manual');

  const transcript = await fetchCaptionTrack(selectedTrack.baseUrl);
  return transcript;
}

const buttonObserver = new MutationObserver(() => {
  addCopyButton();
});

buttonObserver.observe(document.body, {
  childList: true,
  subtree: true
});

// Listen for keyboard shortcuts
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && !event.metaKey && event.key === 'c') {
    event.preventDefault();
    onCopyTranscriptClick();
  }
});
