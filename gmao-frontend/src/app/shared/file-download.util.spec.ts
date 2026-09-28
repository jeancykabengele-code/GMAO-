import { downloadBlob } from './file-download.util';

describe('downloadBlob', () => {
  it('attaches the download link before clicking and revokes the URL later', () => {
    const blob = new Blob(['xlsx']);
    const anchor = document.createElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:gmao-export');
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();

    downloadBlob(blob, 'registre.xlsx');

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toContain('blob:gmao-export');
    expect(anchor.download).toBe('registre.xlsx');
    expect(click).toHaveBeenCalledOnce();
    expect(document.body.contains(anchor)).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:gmao-export');

    vi.useRealTimers();
    createElement.mockRestore();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });
});
