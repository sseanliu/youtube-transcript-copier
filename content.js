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

// Wait for an element to appear in the DOM
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for: ${selector}`));
    }, timeout);
  });
}

// Wait for transcript segments to populate
function waitForSegments(container, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const segments = container.querySelectorAll('ytd-transcript-segment-renderer');
      if (segments.length > 0) return segments;
      return null;
    };

    const existing = check();
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const found = check();
      if (found) {
        observer.disconnect();
        resolve(found);
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error("Timed out waiting for transcript segments to load."));
    }, timeout);
  });
}

// Find and click the "Show transcript" button
async function openTranscriptPanel() {
  // Check if any transcript/engagement panel is already open
  const allPanels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
  for (const p of allPanels) {
    const tid = p.getAttribute('target-id') || '';
    console.log("[Transcript Copier] Found panel with target-id:", tid, "visibility:", p.getAttribute('visibility'));
    if (tid.includes('transcript') && p.getAttribute('visibility')?.includes('EXPANDED')) {
      console.log("[Transcript Copier] Transcript panel already open");
      return p;
    }
  }

  // Try to find "Show transcript" button directly
  let transcriptButton = document.querySelector('button[aria-label="Show transcript"]');
  console.log("[Transcript Copier] Show transcript button (aria-label):", transcriptButton);

  // If not found, try expanding the description first
  if (!transcriptButton) {
    console.log("[Transcript Copier] Looking for transcript button in description...");

    // Try clicking "...more" to expand description
    const moreButton = document.querySelector('tp-yt-paper-button#expand')
      || document.querySelector('#expand')
      || document.querySelector('ytd-text-inline-expander #expand');
    if (moreButton) {
      console.log("[Transcript Copier] Expanding description...");
      moreButton.click();
      await new Promise(r => setTimeout(r, 800));
    }

    transcriptButton = document.querySelector('button[aria-label="Show transcript"]');
    console.log("[Transcript Copier] Show transcript button after expand:", transcriptButton);
  }

  // Also try looking for the button with different selectors
  if (!transcriptButton) {
    // Search by text content
    const allButtons = document.querySelectorAll('button, ytd-button-renderer a, ytd-button-renderer button');
    for (const btn of allButtons) {
      const text = btn.textContent?.trim().toLowerCase();
      if (text && (text.includes('show transcript') || text === 'transcript')) {
        transcriptButton = btn;
        console.log("[Transcript Copier] Found transcript button by text:", text);
        break;
      }
    }
  }

  if (!transcriptButton) {
    throw new Error("Could not find 'Show transcript' button. This video may not have a transcript.");
  }

  console.log("[Transcript Copier] Clicking 'Show transcript' button");
  transcriptButton.click();

  // Wait for any transcript panel to appear
  await new Promise(r => setTimeout(r, 1500));

  // Find the panel - check all engagement panels for one containing transcript
  const panelsAfterClick = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
  let panel = null;
  for (const p of panelsAfterClick) {
    const tid = p.getAttribute('target-id') || '';
    const vis = p.getAttribute('visibility') || '';
    console.log("[Transcript Copier] Panel after click - target-id:", tid, "visibility:", vis);
    if (tid.includes('transcript')) {
      panel = p;
      break;
    }
  }

  if (!panel) {
    // Fallback: find any panel that just became visible
    for (const p of panelsAfterClick) {
      const vis = p.getAttribute('visibility') || '';
      if (vis.includes('EXPANDED')) {
        console.log("[Transcript Copier] Using expanded panel with target-id:", p.getAttribute('target-id'));
        panel = p;
        break;
      }
    }
  }

  if (!panel) {
    throw new Error("Transcript panel did not open after clicking button.");
  }

  return panel;
}

async function fetchTranscript() {
  console.log("[Transcript Copier] Opening transcript panel...");
  const panel = await openTranscriptPanel();

  console.log("[Transcript Copier] Waiting for segments to load...");
  console.log("[Transcript Copier] Panel innerHTML preview:", panel.innerHTML.substring(0, 500));

  // Wait for content to render
  await new Promise(r => setTimeout(r, 2000));

  // Debug: log all child element tag names in the panel
  const allChildren = panel.querySelectorAll('*');
  const tagNames = new Set();
  allChildren.forEach(el => tagNames.add(el.tagName.toLowerCase()));
  console.log("[Transcript Copier] All tag names in panel:", [...tagNames].join(', '));

  // Try multiple segment selectors
  const segmentSelectors = [
    'ytd-transcript-segment-renderer',
    'yt-transcript-segment-renderer',
    '[class*="transcript-segment"]',
    '.segment-text',
    'ytd-transcript-segment-list-renderer .segment',
  ];

  let segments = null;
  for (const sel of segmentSelectors) {
    const found = panel.querySelectorAll(sel);
    console.log("[Transcript Copier] Selector", sel, "found:", found.length);
    if (found.length > 0) {
      segments = found;
      break;
    }
  }

  // If no segments found, try searching the entire document (panel might be elsewhere)
  if (!segments || segments.length === 0) {
    for (const sel of segmentSelectors) {
      const found = document.querySelectorAll(sel);
      console.log("[Transcript Copier] Document-wide selector", sel, "found:", found.length);
      if (found.length > 0) {
        segments = found;
        break;
      }
    }
  }

  if (!segments || segments.length === 0) {
    // Last resort: dump panel content for debugging
    console.log("[Transcript Copier] Panel full HTML (first 3000 chars):", panel.innerHTML.substring(0, 3000));
    throw new Error("Could not find transcript segments. Check console for panel HTML.");
  }

  console.log("[Transcript Copier] Found", segments.length, "segments");

  // Extract text from segments
  let transcript = '';
  for (const segment of segments) {
    // Try multiple selectors for the text content
    const textEl = segment.querySelector('.segment-text')
      || segment.querySelector('yt-formatted-string.segment-text')
      || segment.querySelector('yt-formatted-string')
      || segment.querySelector('[class*="segment-text"]');

    if (textEl) {
      const text = textEl.textContent?.trim();
      if (text) {
        transcript += text + ' ';
      }
    } else {
      // Fallback: get all text from the segment, excluding timestamp
      const timestampEl = segment.querySelector('.segment-timestamp')
        || segment.querySelector('[class*="timestamp"]');
      const fullText = segment.textContent?.trim();
      const timestampText = timestampEl?.textContent?.trim() || '';
      const text = fullText?.replace(timestampText, '').trim();
      if (text) {
        transcript += text + ' ';
      }
    }
  }

  if (!transcript.trim()) {
    throw new Error("Transcript was empty after scraping segments.");
  }

  console.log("[Transcript Copier] Got transcript, length:", transcript.length);

  // Close the transcript panel to clean up
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
