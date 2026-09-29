import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditWorkForm } from './EditWorkForm';
import { EditRecordForm } from './EditRecordForm';

vi.mock('@/hooks/useCatalogMutations', () => ({
  useUpdateWork: () => ({}), useDeleteWork: () => ({}),
  useUpdateRecord: () => ({}), useDeleteRecord: () => ({}),
}));

describe('metadata form refresh', () => {
  it('shows the fetched work title and abstract without losing an unsaved subtitle', () => {
    const props = { workId: 'work', title: 'uploaded-file', subtitle: null, abstract: null, language: 'en', workType: 'book' };
    const { rerender } = render(<EditWorkForm {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Subtitle (optional)'), { target: { value: 'My subtitle' } });
    rerender(<EditWorkForm {...props} title="Fundamentals of vehicle dynamics" abstract="Book description" />);
    expect(screen.getByPlaceholderText('Title')).toHaveValue('Fundamentals of vehicle dynamics');
    expect(screen.getByPlaceholderText('Abstract (optional)')).toHaveValue('Book description');
    expect(screen.getByPlaceholderText('Subtitle (optional)')).toHaveValue('My subtitle');
  });

  it('shows the fetched publisher and publication date in the edition inputs', () => {
    const props = { workId: 'work', recordId: 'record', title: null, publisher: null, edition: null, volume: null, issueNumber: null, pages: null, publicationDate: null };
    const { rerender } = render(<EditRecordForm {...props} />);
    rerender(<EditRecordForm {...props} publisher="Society of Automotive Engineers" publicationDate="1992-01-01" />);
    expect(screen.getByPlaceholderText('Publisher')).toHaveValue('Society of Automotive Engineers');
    expect(screen.getByLabelText('Publication date')).toHaveValue('1992-01-01');
  });
});
