/**
 * Parser for GitHub repository links and shorthand inputs.
 */

export interface RepoParseOk {
  ok: true;
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
}

export interface RepoParseFailure {
  ok: false;
  error: string;
}

export type RepoParseResult = RepoParseOk | RepoParseFailure;

export function parseRepoInput(input: string): RepoParseResult {
  const errorMsg = 'Not a recognised GitHub repository link.';

  // Rule a: Trim whitespace. Remove everything from the first "?" or "#" onward. Remove one trailing "/" if present.
  let text = input.trim();
  const match = text.match(/[?#]/);
  if (match && match.index !== undefined) {
    text = text.slice(0, match.index);
  }
  if (text.endsWith('/')) {
    text = text.slice(0, -1);
  }

  // Rule b: If the text starts with "https://github.com/" or "https://www.github.com/", take the remainder as the path.
  // Otherwise, if the text contains no ":" and no "." before its first "/" (or anywhere, when it has no "/"), treat the whole text as the path.
  // Otherwise return error.
  let path = '';
  if (text.startsWith('https://github.com/')) {
    path = text.slice('https://github.com/'.length);
  } else if (text.startsWith('https://www.github.com/')) {
    path = text.slice('https://www.github.com/'.length);
  } else {
    const slashIdx = text.indexOf('/');
    const prefix = slashIdx !== -1 ? text.slice(0, slashIdx) : text;
    if (prefix.includes(':') || prefix.includes('.')) {
      return { ok: false, error: errorMsg };
    }
    path = text;
  }

  // Rule c: Split the path on "/". Segment 1 is owner, segment 2 is repo. Fewer than two segments returns error.
  const segments = path.split('/');
  if (segments.length < 2) {
    return { ok: false, error: errorMsg };
  }
  const owner = segments[0];
  let repo = segments[1];

  // Rule d: Remove a trailing ".git" from repo.
  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  // Rule e: owner must match ^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$ and repo must match ^[A-Za-z0-9._-]{1,100}$ and repo must not equal "." or "..".
  const ownerRegex = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  const repoRegex = /^[A-Za-z0-9._-]{1,100}$/;
  if (!ownerRegex.test(owner) || !repoRegex.test(repo) || repo === '.' || repo === '..') {
    return { ok: false, error: errorMsg };
  }

  // Rule f: If there are exactly two segments, return {ok: true, owner, repo}.
  if (segments.length === 2) {
    return { ok: true, owner, repo };
  }

  // Rule g: If segment 3 is "tree" and there are at least four segments: ref is segment 4; if there are more than four segments, subpath is segments 5 onward joined with "/".
  if (segments[2] === 'tree' && segments.length >= 4) {
    const ref = segments[3];
    if (segments.length > 4) {
      const subpath = segments.slice(4).join('/');
      return { ok: true, owner, repo, ref, subpath };
    }
    return { ok: true, owner, repo, ref };
  }

  // Rule h: Every other shape returns the error.
  return { ok: false, error: errorMsg };
}
