import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectArtifacts } from './artifacts.ts';

describe('collectArtifacts', () => {
  it('includes writes of html/video and reads of any file', () => {
    const items = [
      {
        kind: 'tool',
        id: '1',
        toolName: 'write',
        input: { path: 'site/index.html' },
        done: true,
      },
      {
        kind: 'tool',
        id: '2',
        toolName: 'read',
        input: { path: 'clip.mp4' },
        done: true,
      },
      {
        kind: 'tool',
        id: '3',
        toolName: 'bash',
        input: { command: 'ls' },
        done: true,
      },
    ];
    const arts = collectArtifacts(items as Parameters<typeof collectArtifacts>[0]);
    assert.deepEqual(
      arts.map((a) => [a.path, a.kind]),
      [
        ['site/index.html', 'html'],
        ['clip.mp4', 'video'],
      ],
    );
  });

  it('includes user attachments', () => {
    const items = [
      {
        kind: 'user' as const,
        id: 'u',
        text: '看看这个',
        attachments: [{ path: '/w/.longma-uploads/a.webm', name: 'a.webm', kind: 'file' as const }],
      },
    ];
    const arts = collectArtifacts(items);
    assert.equal(arts[0]?.kind, 'video');
    assert.equal(arts[0]?.toolName, 'attach');
  });
});
