import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditWorkForm } from './EditWorkForm';
import { EditRecordForm } from './EditRecordForm';

const saveRecord = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useCatalogMutations', () => ({
  useUpdateWork: () => ({}), useDeleteWork: () => ({}),
  useUpdateRecord: () => ({ mutate: saveRecord }), useDeleteRecord: () => ({}),
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
    const props = { workId: 'work', recordId: 'record', recordType: 'edition', title: null, publisher: null, edition: null, volume: null, issueNumber: null, pages: null, publicationDate: null };
    const { rerender } = render(<EditRecordForm {...props} />);
    rerender(<EditRecordForm {...props} publisher="Society of Automotive Engineers" publicationDate="1992-01-01" />);
    expect(screen.getByPlaceholderText('Publisher')).toHaveValue('Society of Automotive Engineers');
    expect(screen.getByLabelText('Publication date')).toHaveValue('1992-01-01');
  });

  it('specializes each record type and preserves hidden fields when saving', () => {
    const props = { workId: 'work', recordId: 'record', recordType: 'edition', title: null, publisher: 'Publisher', edition: 'First', volume: '5', issueNumber: '2', pages: null, publicationDate: null, metadata: { container_title: 'Existing journal', version: 'preprint' } };
    render(<EditRecordForm {...props} />);
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'article_version' } });
    expect(screen.queryByPlaceholderText('Edition')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Journal')).toHaveValue('Existing journal');
    fireEvent.change(screen.getByLabelText('Journal'), { target: { value: 'New journal' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    const saved = saveRecord.mock.lastCall![0];
    expect(saved.patch.record_type).toBe('article_version');
    expect(saved.patch).not.toHaveProperty('edition');
    expect(saved.metadataPatch).toEqual({ container_title: 'New journal' });
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'thesis' } });
    expect(screen.getByLabelText('University')).toHaveValue('Publisher');
    expect(screen.getByLabelText('Degree')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Volume')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'report' } });
    expect(screen.getByLabelText('Issuing institution')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'standard' } });
    expect(screen.getByLabelText('Standards body')).toBeInTheDocument();
    expect(screen.getByLabelText('Revision')).toHaveValue('First');
    expect(screen.queryByPlaceholderText('Issue no.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'edition' } });
    expect(screen.getByLabelText('Edition')).toHaveValue('First');
  });
});
