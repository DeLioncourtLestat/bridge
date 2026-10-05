import { describe, expect, it } from 'vitest'
import { parseAssistant } from '../../src/shared/assistantParse'

describe('offline assistant parser', () => {
  it('creates tasks with priority (English and Russian)', () => {
    expect(parseAssistant('Create task fix week start on Monday, urgent')).toEqual([{ type: 'create_task', title: 'Fix week start on Monday', description: '', priority: 'high' }])
    expect(parseAssistant('Создай задачу добавить экспорт в ics')[0]).toMatchObject({ type: 'create_task', title: 'Добавить экспорт в ics', priority: 'med' })
    expect(parseAssistant('task: tidy docs, low')[0]).toMatchObject({ title: 'Tidy docs', priority: 'low' })
  })
  it('creates notes, splitting title and body on a dash', () => {
    expect(parseAssistant('Note: Supabase — keep refresh tokens server-side')).toEqual([{ type: 'create_note', title: 'Supabase', body: 'keep refresh tokens server-side' }])
    expect(parseAssistant('Запиши в заметку идея: шаблоны дня')[0]).toMatchObject({ type: 'create_note', title: 'Идея', body: 'шаблоны дня' })
  })
  it('lists tasks and ignores the rest', () => {
    expect(parseAssistant('What tasks are open?')).toEqual([{ type: 'list_tasks' }])
    expect(parseAssistant('Какие задачи открыты?')).toEqual([{ type: 'list_tasks' }])
    expect(parseAssistant('hello there')).toEqual([])
  })
})
