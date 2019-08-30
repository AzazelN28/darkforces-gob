const fs = require('fs')
const path = require('path')
const { createInterface } = require('readline')

/**
 * Lee una cadena de longitud fija del buffer pasado
 * @param {Buffer} buffer
 * @param {number} offset
 * @param {number} length
 * @returns {string}
 */
function readString(buffer, offset, length) {
  let string = ''
  for (let index = 0; index < length; index++) {
    const currentOffset = offset + index
    string += String.fromCharCode(buffer.readUInt8(currentOffset))
  }
  return string
}

/**
 * Lee una cadena de texto de longitud variable desde un punto del buffer hasta otro.
 * @param {Buffer} buffer
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
function readNullString(buffer, start, end) {
  let string = ''
  for (let offset = start; offset < end; offset++) {
    const charCode = buffer.readUInt8(offset)
    if (charCode === 0) {
      return string
    }
    string += String.fromCharCode(charCode)
  }
  return string
}

/**
 * Escribe una cadena de texto de longitud fija en el buffer.
 * @param {Buffer} buffer
 * @param {number} offset
 * @param {string} value
 */
function writeString(buffer, offset, value) {
  for (let index = 0; index < value.length; index++) {
    buffer.writeUInt8(value.charCodeAt(index) & 0xFF, offset + index)
  }
}

/**
 * Escribe una cadena de texto terminada en null.
 * @param {Buffer} buffer
 * @param {number} start
 * @param {number} end
 * @param {string} value
 */
function writeNullString(buffer, start, end, value) {
  for (let offset = start; offset < end; offset++) {
    const index = offset - start
    if (index < value.length) {
      buffer.writeUInt8(value.charCodeAt(index) & 0xFF, offset)
    } else {
      buffer.writeUInt8(0x00, offset)
    }
  }
}

/**
 * Guarda una entrada.
 * @param {Entry} entry
 * @param {string} fileName
 */
function exportEntry(entry, fileName) {
  fs.writeFileSync(fileName || entry.name, entry.buffer.slice(entry.start, entry.start + entry.size)) 
  console.log(`Writing ${entry.name.padEnd(16, ' ')}${entry.size}`)
}

/**
 * Intenta exportar una entrada.
 * @param {Entry} entryToExport
 * @param {string} filterName
 * @param {string} outputName
 */
function tryExportEntry(entryToExport, filterName, outputName) {
  const entry = entries.find(entry => entryToExport.name.toLowerCase() === filterName.toLowerCase())
  if (!entry) {
    console.log(`File ${fileName} not found`)
  } else {
    exportEntry(entry, outputName)
  }
}

/**
 * Exporta todas las entradas que posean la extensión.
 * @param {Array<Entry>} entries
 * @param {string} extension
 */
function exportEntriesByExtension(entries, extension) {
  for (const entry of entries) {
    if (entry.name.substr(-3).toLowerCase() === extension.toLowerCase()) {
      exportEntry(entry)
    }
  }
}

/**
 * Lee un archivo .GOB
 * @param {Buffer} buffer
 * @param {Array<Entry>} [entries]
 * @returns {Array<Entry>}
 */
function read(buffer, entries = []) {
  const signature = readString(buffer, 0, 4) 
  if (signature !== 'GOB\x0A') {
    throw new Error('Invalid GOB header')
  }
  let offset = buffer.readUInt32LE(4)
  const count = buffer.readUInt32LE(offset)
  offset += 4
  for (let index = 0; index < count; index++) {
    const name = readNullString(buffer, offset + 8, offset + 21)
    const start = buffer.readUInt32LE(offset)
    const size = buffer.readUInt32LE(offset + 4)
    const entry = {
      start,
      size,
      name,
      buffer
    }
    entries.push(entry)
    offset += 21
  }
  return entries
}

/**
 * Escribe un archivo .GOB
 * @param {Array<Entry>} entries
 * @returns {Buffer}
 */
function write(entries) {
  const buffer = Buffer.alloc(entries.reduce((size, entry) => size + entry.size, 12 + entries.length * 21))
  
  let offset = 8

  const count = entries.length
  writeString(buffer, 0, 'GOB\x0A')

  // Escribimos los datos
  for (const entry of entries) {
    console.log(`Writing ${entry.name} at ${offset}:${entry.size}`)
    if (entry.buffer) {
      entry.buffer.copy(buffer, offset, entry.start, entry.start + entry.size)
      entry.start = offset
    } else if (entry.content) {
      entry.content.copy(buffer, offset)
    } else {
      throw new Error('Invalid entry')
    }
    offset += entry.size
  }
  
  // Escribimos el directorio
  buffer.writeUInt32LE(offset, 4)
  console.log(`Writing directory at ${offset}`)
  buffer.writeUInt32LE(count, offset)
  console.log(`Writing directory count ${count}`)

  offset += 4
  for (const entry of entries) {
    console.log(`${entry.name.padEnd(16, ' ')}${entry.size.toString().padStart(16,' ')}${entry.start.toString().padStart(16,' ')}`)
    writeNullString(buffer, offset + 8, offset + 21, entry.name)
    buffer.writeUInt32LE(entry.start, offset)
    buffer.writeUInt32LE(entry.size, offset + 4)
    offset += 21
  }

  return buffer
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
})

let gobName = process.argv[2]
if (!gobName) {
  console.log('You should specify a .GOB file')
  process.exit(1)
}

const entries = read(fs.readFileSync(gobName))

/**
 * Escuchamos a la entrada de líneas.
 * @param {string} line
 */
rl.on('line', (line) => {
  const [command, ...params] = line.split(' ')
  switch (command) {
    default:
      console.log(`Unknown command ${command}`)
      break
    case 'l':
    case 'ld':
    case 'load':
      if (params.length === 0) {
        console.log('Invalid number of arguments')
      } else if (params.length === 1) {
        while (entries.pop()) {}
        gobName = params[0]
        read(fs.readFileSync(gobName), entries)
      }
      break
    case 's':
    case 'sv':
    case 'save':
      console.log(`Writing to ${gobName}`)
      fs.writeFileSync(params[0] || gobName, write(entries))
      console.log(`${gobName} wrote`)
      break
    case 'i':
    case 'im':
    case 'import':
      if (params.length === 0) {
        console.log('Invalid number of arguments')
      } else if (params.length >= 1) {
        const content = fs.readFileSync(params[0])
        const size = content.byteLength
        const name = params.length === 2 ? params[1] : path.basename(params[0])
        let start = 8
        if (entries.length > 0 ) {
          const last = entries[entries.length - 1]
          start = last.start + last.size
        }
        entries.push({
          name,
          start,
          size,
          content 
        })
      }
      break
    case 'x':
    case 'ex':
    case 'export':
      if (params.length === 0) {
        for (const entry of entries) {
          exportEntry(entry)
        }
      } else if (params.length === 1) {
        const matches = params[0].match(/^(\*|[A-Z0-9]{1,8})\.([A-Z]{1,3})/)
        if (matches) {
          const [, name, extension] = matches
          const fileName = `${name}.${extension}`
          if (name === '*') {
            exportEntriesByExtension(entries, extension)
          } else {
            tryExportEntry(entry, fileName)
          }
        } else {
          console.log('Invalid file name or pattern')
        }
      } else if (params.length === 2) {
        tryExportEntry(entry, fileName, params[1])
      } else {
        console.log('Invalid number of arguments')
      }
      break
    case 'ls':
    case 'dir':
    case 'list':
      if (params.length === 0) {
        for (const entry of entries) {
          if (entry.buffer) {
            console.log(`${entry.name.padEnd(16, ' ')}${entry.size.toString().padStart(16,' ')}${entry.start.toString().padStart(16,' ')}`)
          } else if (entry.content) {
            console.log(`*${entry.name.padEnd(15, ' ')}${entry.size.toString().padStart(16,' ')}${entry.start.toString().padStart(16,' ')}`)
          } else {

          }
        }
      } else if (params.length === 1) {
        const matches = params[0].match(/^\*\.([A-Z]{1,3})/)
        if (matches) {
          const [, extension] = matches
          for (const entry of entries) {
            if (entry.name.substr(-3).toLowerCase() === extension.toLowerCase()) {
              if (entry.buffer) {
                console.log(`${entry.name.padEnd(16, ' ')}${entry.size.toString().padStart(16,' ')}${entry.start.toString().padStart(16,' ')}`)
              } else if (entry.content) {
                console.log(`*${entry.name.padEnd(15, ' ')}${entry.size.toString().padStart(16,' ')}${entry.start.toString().padStart(16,' ')}`)
              } else {

              }
            }
          }
        }
      } else {
        console.log('Invalid number of arguments')
      }
      break

    case 'h':
    case 'help':
      console.log('Help')
      console.log('h|help       Shows this help')
      console.log('ls|dir|list  List files contained in this .GOB file')
      console.log('l|ld|load    Loads another .GOB file')
      console.log('s|sv|save    Saves this .GOB file')
      console.log('x|ex|export  Exports files from this .GOB file')
      console.log('i|im|import  Imports files into this .GOB file')
      break

    case 'quit':
    case 'exit':
      process.exit(0)
      break
  }
})
