import type { Video } from '../api'
import { useT } from '../i18n'
import { Button } from '../kit/controls'
import { Dialog } from '../kit/Dialog'
import { Illustration, Source } from './VideoPicker'

/** Long to Short ជំហាន ១: dialog ជ្រើសវីដេអូ. ជ្រើសរួច App បិទវា ហើយបើក `ClipSettingsPage`
 *  ក្នុងផ្ទៃមាតិកា (រូបតូច + ការកំណត់). វីដេអូនៅលើកុំព្យូទ័រនេះ — គ្មានការ upload ពិតទេ. */
export function ClipPickDialog({
  videos,
  dropOver,
  error,
  connected,
  onChoose,
  onChoosePath,
  onRetry,
  onClose,
}: {
  videos: Video[] // samples/
  dropOver: boolean // file កំពុងអូសលើ window (Tauri)
  error: string
  connected: boolean
  onChoose: (video: Video) => void
  onChoosePath: (path: string) => void
  onRetry: () => void
  onClose: () => void
}) {
  const t = useT()
  return (
    <Dialog width={640} title="Long to Short" onClose={onClose}>
      <p className="-mt-2.5 type-body-lg text-text-3">
        {t(
          'AI រក hook និង highlight ហើយបម្លែងវីដេអូរបស់អ្នកជា clips ខ្លីសម្រាប់ TikTok, Reels និង Shorts។',
          'AI finds the hooks and highlights and turns your video into short clips for TikTok, Reels and Shorts.',
        )}
      </p>
      {error && (
        <div className="flex items-center gap-3 rounded-[12px] bg-raised px-4 py-3">
          <span className={`flex-1 type-label ${connected ? 'text-danger' : 'text-text-3'}`}>{error}</span>
          {!connected && (
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}
      {/* វីដេអូគំរូធំជាងគេ = វីដេអូវែង (podcast) ដែលឧបករណ៍នេះសម្រាប់ */}
      <Illustration video={[...videos].sort((a, b) => b.mb - a.mb)[0] ?? null} />
      <Source videos={videos} dropOver={dropOver} onChoose={onChoose} onChoosePath={onChoosePath} />
    </Dialog>
  )
}
