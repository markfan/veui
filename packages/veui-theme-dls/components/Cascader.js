import { IconChevronDown, IconTimesCircle } from 'dls-icons-vue'
import config from 'veui/managers/config'

const TAG_SIZE_MAP = {
  xs: 's',
  s: 's',
  m: 's',
  l: 'm'
}

config.defaults(
  {
    icons: {
      expand: IconChevronDown,
      collapse: IconChevronDown,
      clear: IconTimesCircle,
      separator: IconChevronDown
    },
    ui: {
      size: {
        values: ['xs', 's', 'm', 'l'],
        inherit: true,
        default: 'm'
      }
    },
    parts: {
      clear: 'icon aux',
      tag: ({ size }) => TAG_SIZE_MAP[size] || size
    }
  },
  'cascader'
)
