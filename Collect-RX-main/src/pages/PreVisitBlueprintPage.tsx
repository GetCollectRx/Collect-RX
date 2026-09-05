import PreVisitBlueprint from '../components/PreVisitBlueprint'

export default function PreVisitBlueprintPage() {
  return (
    <div className="page-enter p-6 space-y-6">
      <div>
        <h1 className="page-title">Pre-Visit Blueprint</h1>
        <p className="page-subtitle">
          Quote the exact CDCP/ODA cost split for a patient at checkout, before treatment — eliminates
          "why is my bill different than I expected" conversations.
        </p>
      </div>
      <PreVisitBlueprint />
    </div>
  )
}
