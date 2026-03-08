// YouTube Transcript Copier - DOM-based approach
// Clicks "Show transcript" button and scrapes text from the transcript panel.

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

// Find the transcript panel (opened or hidden)
function findTranscriptPanel() {
  const allPanels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
  for (const p of allPanels) {
    const tid = p.getAttribute('target-id') || '';
    if (tid.includes('transcript')) {
      return p;
    }
  }
  return null;
}

// Open the transcript panel by clicking "Show transcript"
async function openTranscriptPanel() {
  // Check if transcript panel is already expanded
  const existingPanel = findTranscriptPanel();
  if (existingPanel && existingPanel.getAttribute('visibility')?.includes('EXPANDED')) {
    return existingPanel;
  }

  // Find "Show transcript" button
  let transcriptButton = document.querySelector('button[aria-label="Show transcript"]');

  // If not found, expand description first
  if (!transcriptButton) {
    const moreButton = document.querySelector('tp-yt-paper-button#expand')
      || document.querySelector('#expand')
      || document.querySelector('ytd-text-inline-expander #expand');
    if (moreButton) {
      moreButton.click();
      await new Promise(r => setTimeout(r, 800));
    }
    transcriptButton = document.querySelector('button[aria-label="Show transcript"]');
  }

  // Fallback: search by text content
  if (!transcriptButton) {
    const allButtons = document.querySelectorAll('button, ytd-button-renderer button');
    for (const btn of allButtons) {
      const text = btn.textContent?.trim().toLowerCase();
      if (text && (text.includes('show transcript') || text === 'transcript')) {
        transcriptButton = btn;
        break;
      }
    }
  }

  if (!transcriptButton) {
    throw new Error("Could not find 'Show transcript' button. This video may not have a transcript.");
  }

  transcriptButton.click();
  await new Promise(r => setTimeout(r, 1500));

  // Find the expanded transcript panel
  const panel = findTranscriptPanel();
  if (!panel) {
    throw new Error("Transcript panel did not open after clicking button.");
  }

  return panel;
}

// Check for transcript segments in panel or document
function findSegments(panel) {
  // New YouTube uses transcript-segment-view-model
  let segments = panel.querySelectorAll('transcript-segment-view-model');
  if (segments.length > 0) return segments;
  // Try document-wide
  segments = document.querySelectorAll('transcript-segment-view-model');
  if (segments.length > 0) return segments;
  // Fallback: old selector
  segments = panel.querySelectorAll('ytd-transcript-segment-renderer');
  if (segments.length > 0) return segments;
  segments = document.querySelectorAll('ytd-transcript-segment-renderer');
  if (segments.length > 0) return segments;
  return null;
}

// Wait for transcript segments to appear with polling fallback
function waitForSegments(panel, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const existing = findSegments(panel);
    if (existing) {
      resolve(existing);
      return;
    }

    // Use both MutationObserver and polling for reliability
    const observer = new MutationObserver(() => {
      const found = findSegments(panel);
      if (found) {
        observer.disconnect();
        clearInterval(pollInterval);
        clearTimeout(timer);
        resolve(found);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Poll every 500ms as backup (some elements render without triggering observer)
    const pollInterval = setInterval(() => {
      const found = findSegments(panel);
      if (found) {
        observer.disconnect();
        clearInterval(pollInterval);
        clearTimeout(timer);
        resolve(found);
      }
    }, 500);

    const timer = setTimeout(() => {
      observer.disconnect();
      clearInterval(pollInterval);
      reject(new Error("Timed out waiting for transcript segments to load."));
    }, timeout);
  });
}

async function fetchTranscript() {
  const panel = await openTranscriptPanel();
  console.log("[Transcript Copier] Panel found, waiting for segments...");

  // Wait for segments to render (longer wait for long videos)
  await new Promise(r => setTimeout(r, 2000));
  const segments = await waitForSegments(panel, 20000);

  console.log("[Transcript Copier] Found", segments.length, "segments");

  // Each segment's textContent is: "<short_ts><long_ts><actual text>"
  // Short: "0:37" or "2:33:59" (H:MM:SS for videos over 1hr)
  // Long: "37 seconds" or "2 hours, 33 minutes, 59 seconds"
  // They concatenate without spaces, e.g. "2:33:592 hours, 33 minutes, 59 secondsroutine or yoga..."
  const timestampPrefix = /^\d+:\d{2}(:\d{2})?(\d+\s+hours?,\s*\d+\s+minutes?,\s*\d+\s+seconds?|\d+\s+minutes?,\s*\d+\s+seconds?|\d+\s+seconds?|\d+\s+minutes?|\d+\s+hours?)?/;

  let transcript = '';
  for (const segment of segments) {
    const raw = segment.textContent?.trim();
    if (!raw) continue;
    const cleaned = raw.replace(timestampPrefix, '').trim();
    if (cleaned) {
      transcript += cleaned + ' ';
    }
  }

  if (!transcript.trim()) {
    throw new Error("Transcript was empty after scraping segments.");
  }

  console.log("[Transcript Copier] Got transcript, length:", transcript.length);

  // Close the transcript panel
  const closeButton = panel.querySelector('#visibility-button button')
    || panel.querySelector('button[aria-label="Close transcript"]');
  if (closeButton) {
    closeButton.click();
  }

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
