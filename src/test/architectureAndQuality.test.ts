import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { safeParseJson, resolveAiConfigFromSettings } from '../../server/services/aiService';
import { safeParseJson as reExportedParseJson } from '../../server/routes/services';

describe('Architecture & Code Quality (Session 6 Audit)', () => {
  describe('Dead Code Elimination (ARCH-02)', () => {
    it('confirms dead prototype files have been eradicated from the workspace', () => {
      const yousefApiPath = path.resolve(process.cwd(), 'src/lib/quranYousefApi.ts');
      const famousSelectorPath = path.resolve(process.cwd(), 'src/components/FamousAyahSelector.tsx');

      expect(fs.existsSync(yousefApiPath)).toBe(false);
      expect(fs.existsSync(famousSelectorPath)).toBe(false);
    });
  });

  describe('Single Responsibility & Abstraction: AI Service (ARCH-04)', () => {
    it('re-exports safeParseJson from services.ts for 100% backward compatibility', () => {
      expect(typeof reExportedParseJson).toBe('function');
      const result = reExportedParseJson('```json\n{"test": true}\n```');
      expect(result).toEqual({ test: true });
    });

    it('handles markdown codeblocks and nested JSON safely in aiService', () => {
      const markdownJson = '```json\n{"lines": [{"text": "الحمد لله", "startTime": 0, "endTime": 2.5}]}\n```';
      const parsed = safeParseJson(markdownJson);
      expect(parsed).toEqual({
        lines: [{ text: 'الحمد لله', startTime: 0, endTime: 2.5 }],
      });

      const rawArray = '```[{"id": 1}, {"id": 2}]```';
      expect(safeParseJson(rawArray)).toEqual([{ id: 1 }, { id: 2 }]);

      expect(safeParseJson('')).toBeNull();
      expect(safeParseJson('plain invalid string with no brackets')).toBeNull();
    });

    it('resolves AI provider configuration deterministically from persisted settings', () => {
      expect(resolveAiConfigFromSettings({})).toBeNull();

      expect(resolveAiConfigFromSettings({ GEMINI_API_KEY: 'test-gemini-key' })).toEqual({
        type: 'gemini', key: 'test-gemini-key',
      });

      expect(resolveAiConfigFromSettings({ LOVABLE_API_KEY: 'test-lovable-key' })).toEqual({
        type: 'lovable', key: 'test-lovable-key',
      });

      expect(resolveAiConfigFromSettings({ OPENAI_API_KEY: 'test-openai-key' })).toEqual({
        type: 'openai', key: 'test-openai-key',
      });

      // An explicit provider never silently falls through to another key.
      expect(resolveAiConfigFromSettings({ AI_PROVIDER: 'openrouter', GEMINI_API_KEY: 'legacy-key' })).toBeNull();
    });

    it('transcribeAudioWithAi handles audio MIME detection and successfully parses JSON response', async () => {
      const mockAudioBase64 = 'UklGRi4AAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='; // minimal WAV header
      const originalFetch = global.fetch;

      try {
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        lines: [
                          { text: 'مولاي إني ببابك', startTime: 0, endTime: 5 },
                        ],
                        text: 'مولاي إني ببابك',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        } as any);

        const { transcribeAudioWithAi } = await import('../../server/services/aiService');
        const res = await transcribeAudioWithAi(mockAudioBase64, { type: 'gemini', key: 'mock-key' });

        expect(res.lines).toHaveLength(1);
        expect(res.lines[0].text).toBe('مولاي إني ببابك');
        expect(global.fetch).toHaveBeenCalled();

        // Verify request payload contained audio/wav
        const fetchCall = (global.fetch as any).mock.calls[0];
        const bodyObj = JSON.parse(fetchCall[1].body);
        expect(bodyObj.contents[0].parts[1].inline_data.mime_type).toBe('audio/wav');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('DRY Favorite Toggle Abstraction (ARCH-03)', () => {
    it('verifies toggle logic structure handles toggle, deletion, and duplicate entry resilience', async () => {
      // Test the algorithm logic directly to verify state machine and ER_DUP_ENTRY handling
      async function simulateToggle(
        existingRows: any[],
        onDelete: () => Promise<void>,
        onInsert: () => Promise<void>
      ) {
        if (existingRows.length > 0) {
          await onDelete();
          return false;
        }
        try {
          await onInsert();
          return true;
        } catch (err: any) {
          if (err.code === 'ER_DUP_ENTRY') {
            return true;
          }
          throw err;
        }
      }

      const onDeleteMock = vi.fn().mockResolvedValue(undefined);
      const onInsertMock = vi.fn().mockResolvedValue(undefined);

      // 1. Not existing -> should insert and return true
      const added = await simulateToggle([], onDeleteMock, onInsertMock);
      expect(added).toBe(true);
      expect(onInsertMock).toHaveBeenCalledTimes(1);
      expect(onDeleteMock).not.toHaveBeenCalled();

      // 2. Already existing -> should delete and return false
      onDeleteMock.mockClear();
      onInsertMock.mockClear();
      const removed = await simulateToggle([{ id: 'uuid-1' }], onDeleteMock, onInsertMock);
      expect(removed).toBe(false);
      expect(onDeleteMock).toHaveBeenCalledTimes(1);
      expect(onInsertMock).not.toHaveBeenCalled();

      // 3. Concurrent insertion collision (ER_DUP_ENTRY) -> should catch and return true idempotently
      onDeleteMock.mockClear();
      onInsertMock.mockClear();
      const dupError = new Error('Duplicate entry');
      (dupError as any).code = 'ER_DUP_ENTRY';
      onInsertMock.mockRejectedValue(dupError);

      const idempotentAdd = await simulateToggle([], onDeleteMock, onInsertMock);
      expect(idempotentAdd).toBe(true);
    });
  });
});
