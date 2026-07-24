/** Droppable id for a column's empty space, kept out of the task id space
 *  (todomd ids are four characters of [0-9a-z], so they never collide). */
export const COLUMN_PREFIX = 'column:'

export const columnDroppableId = (board: string) => `${COLUMN_PREFIX}${board}`
