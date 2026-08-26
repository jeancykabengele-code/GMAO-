import { convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { NotificationRecordFocusService } from './notification-record-focus.service';

describe('NotificationRecordFocusService', () => {
  it('réinitialise les filtres et ouvre la page contenant la fiche ciblée', () => {
    const queryParamMap = new BehaviorSubject(convertToParamMap({ record: 'record-25' }));
    const route = { queryParamMap } as never;
    const rows = Array.from({ length: 45 }, (_, index) => ({ id: `record-${index + 1}` }));
    const clearFilters = vi.fn();
    const setPage = vi.fn();
    const service = new NotificationRecordFocusService();

    service.bind(route, { rows: () => rows, clearFilters, setPage, pageSize: 20 });

    expect(clearFilters).toHaveBeenCalledOnce();
    expect(setPage).toHaveBeenCalledWith(2);
    expect(service.isTarget('record-25')).toBe(true);
  });
});
