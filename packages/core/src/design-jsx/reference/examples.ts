import dedent from 'dedent'

export interface AuthoringExample {
  title: string
  jsx: string
}

/** Shared verbatim by runtime prompts and the installable skill; exercised in engine tests. */
export const AUTHORING_EXAMPLES: readonly AuthoringExample[] = [
  {
    title: 'Content-sized review note',
    jsx: dedent`<Frame name="Review note" w={280} h="hug" flex="col" gap={8} p={16} bg="#FFFFFF">
  <Text name="Author" size={12} weight="medium" color="#252A31">June Lee</Text>
  <Text name="Message" w="fill" size={12} color="#6B7079">Give the date a little more room at the bottom.</Text>
</Frame>`
  },
  {
    title: 'Variable-bound spacing and typography',
    jsx: dedent`<Frame name="Bound note" w={280} h="hug" flex="col" gap={designVar('Space/small')} p={designVar('Space/medium')} bg="#FFFFFF">
  <Text name="Message" w="fill" size={designVar('Type/body')} lineHeight={designVar('Type/body-leading')} letterSpacing={designVar('Type/body-tracking')} color="#252A31">A note that grows with its content.</Text>
</Frame>`
  },
  {
    title: 'Text with font, size and weight',
    jsx: dedent`<Text name="Heading" font="Roboto" size={18} weight={600} lineHeight={24} color="#26292E">Кластеры PostgreSQL</Text>`
  },
  {
    title: 'Text that fills the remaining width',
    jsx: dedent`<Frame name="Row" flex="row" gap={8} w="fill" items="center">
  <Text name="Label" grow={1} font="Roboto" size={14} lineHeight={20} color="#26292E">Реплика pg-core-02</Text>
  <Text name="Value" font="Roboto" size={14} lineHeight={20} color="#6B7280">16.3</Text>
</Frame>`
  },
  {
    title: 'A glyph drawn inline with svg',
    jsx: dedent`<svg name="chevron" size={16} viewBox="0 0 24 24" stroke="#6B7280">
  <path d="M9 6 L15 12 L9 18" fill="none" stroke-width="2" />
</svg>`
  },
  {
    title: 'An svg glyph inside a row',
    jsx: dedent`<Frame name="Sort header" flex="row" gap={4} items="center">
  <Text name="Title" font="Roboto" size={14} weight={500} color="#26292E">Версия ПО</Text>
  <svg name="sort" size={16} viewBox="0 0 24 24" stroke="#26292E">
    <path d="M7 10 L12 5 L17 10" fill="none" stroke-width="2" />
  </svg>
</Frame>`
  },
  {
    title: 'An instance of an existing component',
    jsx: dedent`<Instance name="Status badge" of="0:1234" x={0} y={0} />`
  },
  {
    title: 'Variants of a component set',
    jsx: dedent`<Frame name="Card actions" flex="row" gap={8}>
  <Instance name="Save" of="button" Type="Filled" Size="Large" />
  <Instance name="Cancel" of="button" Type="Outline" Size="Large" />
</Frame>`
  },
  {
    title: 'An instance label set through a component property',
    jsx: dedent`<Instance name="Status" of="badge" Color="green" Content="Text only" properties={{ label: 'Working' }} />`
  }
]
