import { Button, Chip } from '../kit/controls'
import { Dialog } from '../kit/Dialog'

/** អ្វីដែល design គូរ តែ app នេះមិនមាន — ប្រាប់ត្រង់ៗ ជាជាងប៊ូតុងដែលគ្មានប្រតិកម្ម.
 *
 *  `account`: គណនី, plan, នាទី, Upgrade. App ដំណើរការក្នុងកុំព្យូទ័រនេះទាំងស្រុង
 *  (CLAUDE.md: no uploads) ដូច្នេះគ្មានអ្វីត្រូវរាប់ ឬបង់ប្រាក់ — screen ទាំងនោះ
 *  ជា stub ដែលមិនផ្ញើអ្វីទៅ network ឡើយ.
 *  `later`: ប៊ូតុងដែលមិនទាន់មានមុខងារ (ជំនួយ, Menu). */
export function PreviewDialog({ kind, onClose }: { kind: 'account' | 'later'; onClose: () => void }) {
  return (
    <Dialog title={kind === 'account' ? 'គណនី និង Billing' : 'មិនទាន់មាន'} onClose={onClose}>
      <Chip>PREVIEW · គ្មាន network</Chip>
      {kind === 'account' ? (
        <p className="type-body text-text-3">
          Khmer Clip Studio ដំណើរការលើកុំព្យូទ័រនេះទាំងស្រុង — វីដេអូមិនត្រូវបាន upload ទេ
          ហើយមិនត្រូវការគណនីដើម្បីបង្កើត clips ឡើយ។ Plan និងនាទីក្នុង design នេះជាគំរូប៉ុណ្ណោះ
          មិនទាន់ភ្ជាប់ទៅប្រព័ន្ធណាមួយទេ។
        </p>
      ) : (
        <p className="type-body text-text-3">
          ប៊ូតុងនេះមានក្នុង design ប៉ុន្តែមិនទាន់មានមុខងារនៅក្នុងកំណែនេះទេ។
        </p>
      )}
      <Button variant="primary" onClick={onClose}>
        យល់ហើយ
      </Button>
    </Dialog>
  )
}
