// OWNER: Frontend/Agent dev. Spec: docs/spec/04-voice-agent.md
import { useConversation } from '@elevenlabs/react'
import { useSession } from '../session/store'
import { clientTools } from './clientTools'
import { api } from '../api'
import { useEffect, useState } from 'react'

export function useAgent() {
  const s = useSession()
  const [signedUrl, setSignedUrl] = useState<string | null>(null)

  useEffect(() => {
    async function fetchUrl() {
      try {
        const data = await api.signedUrl()
        setSignedUrl(data.signedUrl)
      } catch (e) {
        console.error('Failed to get signed URL', e)
      }
    }
    fetchUrl()
  }, [])

  const conversation = useConversation({
    clientTools,
    onConnect: () => s.setAgentConnected(true),
    onDisconnect: () => s.setAgentConnected(false),
  })

  async function start() {
    if (signedUrl) {
      await conversation.startSession({ signedUrl })
    }
  }

  return { ...conversation, start }
}
