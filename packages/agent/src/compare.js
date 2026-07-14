export function score(capture) {
  if (!capture) {
    return { consoleErrors: 0, pageErrors: 0, failedRequests: 0, networkErrors: 0, total: 0 };
  }
  const s = capture.summary || {};
  const consoleErrors = s.consoleErrors ?? 0;
  const pageErrors = s.pageErrors ?? 0;
  const failedRequests = s.failedRequests ?? 0;
  const networkErrors = s.networkErrors ?? 0;
  return {
    consoleErrors,
    pageErrors,
    failedRequests,
    networkErrors,
    total: consoleErrors + pageErrors + failedRequests + networkErrors,
  };
}

export function compareCaptures(before, after, errorDescription, suggestedFiles) {
  const beforeScore = score(before);
  const afterScore = score(after);
  const delta = afterScore.total - beforeScore.total;
  const notes = [];

  if (!suggestedFiles?.length) {
    notes.push('No file patches applied — confirmation is a re-check only.');
  }

  const needle = String(errorDescription || '').split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 80) || '';
  const blob = (c) =>
    [...(c?.pageErrors || []), ...(c?.consoleMessages || []).map((m) => m.text)].join('\n').toLowerCase();
  const beforeHad = needle.length >= 4 && blob(before).includes(needle.toLowerCase());
  const afterHad = needle.length >= 4 && blob(after).includes(needle.toLowerCase());

  let status = 'unchanged';
  if (beforeHad && !afterHad && afterScore.total <= beforeScore.total) {
    status = 'resolved';
    notes.push(`Error text cleared from browser capture.`);
  } else if (afterScore.total === 0 && beforeScore.total > 0) {
    status = 'resolved';
    notes.push('All tracked browser error signals cleared.');
  } else if (delta < 0) {
    status = afterScore.total === 0 ? 'resolved' : 'improved';
    notes.push(`Signals ${beforeScore.total} → ${afterScore.total}`);
  } else if (delta > 0) {
    status = 'worse';
    notes.push(`Signals rose ${beforeScore.total} → ${afterScore.total}`);
  } else {
    notes.push('Signal count unchanged.');
  }

  return { status, before: beforeScore, after: afterScore, delta, notes };
}
