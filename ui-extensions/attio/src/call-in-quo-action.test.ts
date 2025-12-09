import { describe, it, expect, vi } from 'vitest'
import { callInQuoAction } from './call-in-quo-action'

// Mock the attio/client module
vi.mock('attio/client', () => ({
  runQuery: vi.fn(),
  showToast: vi.fn(),
}))

describe('callInQuoAction', () => {
  describe('label', () => {
    it('should be a static string', () => {
      expect(typeof callInQuoAction.label).toBe('string')
    })

    it('should have the label "Call in Quo"', () => {
      expect(callInQuoAction.label).toBe('Call in Quo')
    })
  })

  describe('action behavior', () => {
    it('should apply to both people and companies objects', () => {
      expect(callInQuoAction.objects).toEqual(['people', 'companies'])
    })

    it('should have id "call-in-quo"', () => {
      expect(callInQuoAction.id).toBe('call-in-quo')
    })
  })
})
