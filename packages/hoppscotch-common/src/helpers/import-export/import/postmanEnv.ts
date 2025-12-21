import { Environment, EnvironmentSchemaVersion } from "@hoppscotch/data"
import * as O from "fp-ts/Option"
import * as TE from "fp-ts/TaskEither"
import { z } from "zod"

import { safeParseJSON } from "~/helpers/functional/json"
import { IMPORTER_INVALID_FILE_FORMAT } from "."
import { uniqueID } from "~/helpers/utils/uniqueID"

const postmanEnvSchema = z.object({
  name: z.string(),
  values: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      type: z.string(),
    })
  ),
  _postman_variable_scope: z.enum(["environment", "globals"]),
})

type PostmanEnv = z.infer<typeof postmanEnvSchema>

export type PostmanEnvImportResult = {
  environments: Environment[]
  globalsDetected: boolean
}

export const postmanEnvImporter = (contents: string[]) => {
  const parsedContents = contents.map((str) => safeParseJSON(str, true))
  if (parsedContents.some((parsed) => O.isNone(parsed))) {
    return TE.left(IMPORTER_INVALID_FILE_FORMAT)
  }

  const parsedValues = parsedContents.flatMap((parsed) => {
    const unwrappedEntry = O.toNullable(parsed) as PostmanEnv[] | null

    if (unwrappedEntry) {
      return unwrappedEntry.map((entry) => ({
        ...entry,
        values: entry.values?.map((valueEntry) => ({
          ...valueEntry,
          value: String(valueEntry.value),
          type: String(valueEntry.type),
        })),
      }))
    }
    return null
  })

  const validationResult = z.array(postmanEnvSchema).safeParse(parsedValues)

  if (!validationResult.success) {
    return TE.left(IMPORTER_INVALID_FILE_FORMAT)
  }

  let globalsDetected = false

  // Convert `values` to `variables` to match the format expected by the system
  const environments: Environment[] = validationResult.data.map(
    ({ name, values, _postman_variable_scope }) => {
      // Detect if this is a globals file
      globalsDetected = _postman_variable_scope === "globals"

      return {
        id: uniqueID(),
        v: EnvironmentSchemaVersion,
        name: globalsDetected ? "Global" : name,
        variables: values.map(({ key, value, type }) => ({
          key,
          initialValue: value,
          currentValue: value,
          secret: type === "secret",
        })),
      }
    }
  )

  const result: PostmanEnvImportResult = {
    environments,
    globalsDetected,
  }

  return TE.right(result)
}
