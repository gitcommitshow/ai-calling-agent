/**
 * Unit tests for which captured answers belong on a guest card.
 */
import { expect } from 'chai';
import { capturedAnswers } from '../src/domain/captured';

const fields = [
  { key: 'will_attend', label: 'Will the guest attend?' },
  { key: 'feedback', label: 'Feedback' },
];

describe('capturedAnswers', () => {
  it('keeps a real answer under the field label and drops unknown', () => {
    const answers = capturedAnswers(
      { will_attend: 'yes', feedback: 'unknown' },
      fields,
    );
    expect(answers).to.deep.equal([
      { key: 'will_attend', label: 'Will the guest attend?', value: 'yes' },
    ]);
  });

  it('returns nothing when every value is blank or unknown', () => {
    expect(capturedAnswers({ will_attend: '  ', feedback: 'unknown' }, fields)).to.deep.equal([]);
  });

  it('keeps an answer whose field definition is missing, labeled by its key', () => {
    expect(capturedAnswers({ note: 'arriving late' }, [])).to.deep.equal([
      { key: 'note', label: 'note', value: 'arriving late' },
    ]);
  });
});
