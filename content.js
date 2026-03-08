// This script will be injected into YouTube video pages.
// It will add a "Copy Transcript" button and fetch transcripts via YouTube's API.

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
    const transcriptText = await fetchTranscriptViaAPI();
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

// Extract YouTube's innertube API key and client version from the page HTML
function getYouTubeConfig() {
  const scripts = document.querySelectorAll('script');
  let apiKey = null;
  let clientVersion = null;

  for (const script of scripts) {
    const text = script.textContent;
    if (!apiKey) {
      const keyMatch = text.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
      if (keyMatch) apiKey = keyMatch[1];
    }
    if (!clientVersion) {
      const verMatch = text.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
      if (verMatch) clientVersion = verMatch[1];
    }
    if (apiKey && clientVersion) break;
  }

  return { apiKey, clientVersion };
}

// Build protobuf-encoded params for the get_transcript endpoint
function buildTranscriptParams(videoId) {
  const encoder = new TextEncoder();
  const videoIdBytes = encoder.encode(videoId);

  // Inner message: field 1 (tag 0x0a) = videoId
  const inner = new Uint8Array(2 + videoIdBytes.length);
  inner[0] = 0x0a;
  inner[1] = videoIdBytes.length;
  inner.set(videoIdBytes, 2);

  // Outer message: field 1 (tag 0x0a) = inner
  const outer = new Uint8Array(2 + inner.length);
  outer[0] = 0x0a;
  outer[1] = inner.length;
  outer.set(inner, 2);

  let binary = '';
  for (let i = 0; i < outer.length; i++) {
    binary += String.fromCharCode(outer[i]);
  }
  return btoa(binary);
}

// Fetch transcript directly from YouTube's innertube API
async function fetchTranscriptViaAPI() {
  const videoId = getVideoId();
  if (!videoId) throw new Error("Could not determine video ID.");

  const { apiKey, clientVersion } = getYouTubeConfig();
  if (!apiKey) throw new Error("Could not find YouTube API key on page.");

  const params = buildTranscriptParams(videoId);

  const response = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: clientVersion || '2.20260306.01.00',
        }
      },
      params: params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Transcript API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  console.log("[Transcript Copier] API response:", JSON.stringify(data).substring(0, 500));
  return parseTranscriptResponse(data);
}

function parseTranscriptResponse(data) {
  const actions = data.actions;
  if (!actions || actions.length === 0) {
    throw new Error("This video does not have a transcript available.");
  }

  // Try to find transcript segments in the response
  for (const action of actions) {
    const panel = action.updateEngagementPanelAction?.content;
    if (!panel) continue;

    // Structure 1: transcriptRenderer > body > transcriptBodyRenderer > cueGroups
    const transcriptRenderer = panel.transcriptRenderer;
    if (transcriptRenderer) {
      const body = transcriptRenderer.body?.transcriptBodyRenderer;
      if (body?.cueGroups) {
        return extractFromCueGroups(body.cueGroups);
      }
    }

    // Structure 2: transcriptSearchPanelRenderer > body > transcriptSegmentListRenderer
    const searchPanel = panel.transcriptSearchPanelRenderer;
    if (searchPanel) {
      const segmentList = searchPanel.body?.transcriptSegmentListRenderer;
      if (segmentList?.initialSegments) {
        return extractFromSegments(segmentList.initialSegments);
      }
    }
  }

  throw new Error("Could not parse transcript from API response.");
}

function extractFromCueGroups(cueGroups) {
  let transcript = '';
  for (const group of cueGroups) {
    const cues = group.transcriptCueGroupRenderer?.cues;
    if (!cues) continue;
    for (const cue of cues) {
      const renderer = cue.transcriptCueRenderer;
      if (!renderer) continue;
      const text = renderer.cue?.simpleText ||
                   renderer.cue?.runs?.map(r => r.text).join('') || '';
      if (text.trim()) {
        transcript += text.trim() + ' ';
      }
    }
  }

  if (!transcript.trim()) throw new Error("Transcript cue groups were empty.");
  return transcript.trim();
}

function extractFromSegments(segments) {
  let transcript = '';
  for (const seg of segments) {
    const renderer = seg.transcriptSegmentRenderer;
    if (!renderer) continue;
    const text = renderer.snippet?.runs?.map(r => r.text).join('') ||
                 renderer.snippet?.simpleText || '';
    if (text.trim()) {
      transcript += text.trim() + ' ';
    }
  }

  if (!transcript.trim()) throw new Error("Transcript segments were empty.");
  return transcript.trim();
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
