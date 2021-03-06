<template>
<div
  ref="main"
  :class="{
    [$c('uploader')]: true,
    [$c(`uploader-${isMediaType ? 'media' : type}`)]: true
  }"
  :ui="realUi"
  role="application"
  tabindex="-1"
  :aria-label="t('uploader')"
>
  <component
    :is="`veui-uploader-${isMediaType ? 'media' : 'file'}`"
    :files="fileList"
    :addable="canAddImage"
    :disabled="realUneditable"
    :sortable="!realUneditable && sortable"
    :options="childOptions"
    @move="handleItemMove"
    @add="handleItemAdd"
    @replace="handleItemReplace"
    @remove="handleItemRemove"
    @preview="handleItemPreview"
    @custom="handleItemCustomEvent"
  >
    <template
      v-for="(_, slotName) in $scopedSlots"
      :slot="slotName"
      slot-scope="slotData"
    ><slot
      :name="slotName"
      v-bind="slotData"
    /></template>
  </component>

  <veui-lightbox
    :open.sync="previewOpen"
    :datasource="successFiles"
    :index.sync="previewIndex"
    v-bind="realPreviewOptions"
  />
</div>
</template>

<script>
import {
  some,
  pick,
  includes,
  isString,
  startsWith,
  findIndex,
  find,
  omit,
  isNil,
  values,
  isUndefined,
  noop
} from 'lodash'
import prefix from '../../mixins/prefix'
import ui from '../../mixins/ui'
import input from '../../mixins/input'
import i18n from '../../mixins/i18n'
import { sharedProps } from '../../mixins/upload'
import config from '../../managers/config'
import toast from '../../managers/toast'
import warn from '../../utils/warn'
import { addOnceEventListener } from '../../utils/dom'
import { isSupportFileListContructor } from '../../utils/file'
import Lightbox from '../Lightbox'
import FileUploader from './_FileUploader'
import MediaUploader from './_MediaUploader'
import {
  STATUS,
  ORDERS,
  ERRORS,
  getFileMediaType,
  UploaderFile,
  getUploadRequest
} from './_helper'

config.defaults({
  'uploader.requestMode': 'xhr',
  'uploader.iframeMode': 'postmessage',
  'uploader.callbackNamespace': 'veuiUploadResult',
  'uploader.pickerPosition': 'after',
  'uploader.mediaExtensions': {
    image: [
      'apng',
      'avif',
      'bmp',
      'gif',
      'ico',
      'cur',
      'jpg',
      'jpeg',
      'jfif',
      'pjpeg',
      'pjp',
      'png',
      'svg',
      'tif',
      'tiff',
      'webp'
    ],
    video: ['mp4', 'mov', 'wmv', 'flv', 'avi', 'avchd', 'webm', 'mkv']
  }
})

export default {
  name: 'veui-uploader',
  status: STATUS,
  errors: ERRORS,
  components: {
    'veui-lightbox': Lightbox,
    'veui-uploader-file': FileUploader,
    'veui-uploader-media': MediaUploader
  },
  mixins: [prefix, ui, input, i18n],
  model: {
    event: 'change'
  },
  props: {
    name: {
      type: String,
      default: 'file'
    },
    value: {
      type: [Array, Object]
    },
    type: {
      type: String,
      default: 'file',
      validator (value) {
        return includes(['file', 'media', 'image', 'video'], value)
      }
    },
    action: String,
    headers: {
      type: Object,
      default () {
        return config.get('uploader.headers')
      }
    },
    withCredentials: {
      type: Boolean,
      default: true
    },
    requestMode: {
      type: String,
      default () {
        return config.get('uploader.requestMode')
      },
      validator (value) {
        return includes(['xhr', 'iframe', 'custom'], value)
      }
    },
    iframeMode: {
      type: String,
      default () {
        return config.get('uploader.iframeMode')
      }
    },
    convertResponse: {
      default () {
        return config.get('uploader.convertResponse')
      },
      validator (value) {
        return typeof value === 'function'
      }
    },
    callbackNamespace: {
      type: String,
      default () {
        return config.get('uploader.callbackNamespace')
      }
    },
    dataType: {
      type: String,
      default: 'json',
      validator (value) {
        return includes(['json', 'text'], value)
      }
    },
    extensions: {
      type: Array,
      validator () {
        warn(
          '[veui-uploader] `extensions` is deprecated and will be removed in future versions. Use `accept` instead.',
          this
        )
        return true
      }
    },
    accept: String,
    validator: {
      type: Function
    },
    maxCount: {
      type: Number,
      default: Infinity
    },
    maxSize: [Number, String],
    payload: Object,
    autoupload: {
      type: Boolean,
      default: true
    },
    order: {
      type: String,
      validator (value) {
        return includes(values(ORDERS), value)
      }
    },
    multiple: {
      type: Boolean,
      default: false
    },
    sortable: Boolean,
    upload: Function,
    controls: Function,
    pickerPosition: {
      type: String,
      default () {
        return config.get('uploader.pickerPosition')
      }
    },
    entries: Function,
    previewOptions: {
      type: Object,
      default () {
        return {
          wrap: true,
          indicator: 'number'
        }
      }
    },
    keyField: {
      type: String,
      default: 'key'
    },
    afterPick: Function
  },
  data () {
    return {
      fileList: [],

      previewIndex: 0,
      previewOpen: false
    }
  },
  computed: {
    realUneditable () {
      return this.realDisabled || this.realReadonly
    },
    canAddImage () {
      return !this.realUneditable && this.fileList.length < this.maxCount
    },
    status () {
      if (!this.fileList.length) {
        return STATUS.EMPTY
      }
      let status = find(
        [STATUS.UPLOADING, STATUS.FAILURE, STATUS.PENDING],
        status => this.fileList.some(file => file.status === status)
      )
      return status || STATUS.SUCCESS
    },
    successFiles () {
      return this.fileList
        .filter(file => file.isSuccess)
        .map(file => file.value)
    },
    realOrder () {
      if (this.order) {
        let mapping = {
          [ORDERS.LEGACY_PREPEND]: ORDERS.PREPEND,
          [ORDERS.LEGACY_APPEND]: ORDERS.APPEND
        }
        if (this.order in mapping) {
          warn(
            '[veui-uploader] `desc|asc` are deprecated for `order`. use `prepend|append` instead'
          )
          return mapping[this.order]
        }
        return this.order
      }
      return this.type === 'file' ? ORDERS.PREPEND : ORDERS.APPEND
    },
    isMediaType () {
      return ['image', 'video', 'media'].indexOf(this.type) > -1
    },
    realAccept () {
      if (this.extensions) {
        return this.extensions
          .map(extension =>
            startsWith(extension, '.') ? extension : `.${extension}`
          )
          .join(',')
      }
      if (this.accept) {
        return this.accept
      }

      switch (this.type) {
        case 'media':
          return 'video/*, image/*'
        case 'image':
          return 'image/*'
        case 'video':
          return 'video/*'
      }
      return null
    },
    realPreviewOptions () {
      return omit(this.previewOptions, ['index', 'open'])
    },
    realMultiple () {
      return this.maxCount === 1 ? this.multiple : true
    },

    uploadRequest () {
      const options = pick(this, [
        'name',
        'action',
        'headers',
        'withCredentials',
        'requestMode',
        'iframeMode',
        'callbackNamespace',
        'dataType',
        'convertResponse',
        'payload',
        'upload'
      ])
      return getUploadRequest(options)
    },
    validateOptions () {
      return {
        type: this.type,
        accept: this.realAccept,
        extensions: this.extensions,
        maxSize: this.maxSize,
        validator: this.validator
      }
    },
    childOptions () {
      return pick(this, sharedProps)
    },
    preferType () {
      return includes(['image', 'video'], this.type) ? this.type : undefined
    },
    canMultipleChoose () {
      return this.requestMode !== 'iframe' || isSupportFileListContructor()
    }
  },
  watch: {
    value: {
      handler (val) {
        let values = [].concat(val).filter(Boolean)
        if (process.env.NODE_ENV !== 'test') {
          if (some(values, val => isString(val))) {
            warn('[veui-uploader] `value` must be object(s).', this)
          }
          if (some(values, val => isNil(val[this.keyField]))) {
            warn(
              '[veui-uploader] `key-field` is required of `value` to ensure correct order.',
              this
            )
          }
        }

        let j = 0
        this.fileList = this.fileList
          .map((file, i) => {
            if (!file.isSuccess) {
              return file
            }

            let value = values[j++]
            if (!value) {
              return
            }

            if (value[this.keyField]) {
              let file = find(
                this.fileList,
                file => file.key === value[this.keyField]
              )
              if (file) {
                file.value = value
                return file
              }
            }

            return this.createUploaderFile(value)
          })
          .filter(Boolean)
          .concat(
            // 还有剩的添加到最后（TODO: 需要考虑 order 么？）
            values.slice(j).map(val => this.createUploaderFile(val))
          )
      },
      deep: true,
      immediate: true
    },
    status (val) {
      if (val) {
        this.$emit('statuschange', val)
      }
    }
  },
  created () {
    if (this.requestMode !== 'custom' && !this.action) {
      warn(
        '[veui-uploader] `action` is required when `request-mode` is not `custom`.',
        this
      )
    }
  },
  mounted () {
    this.fileInput = this.createInputElement()
    this.$refs.main.appendChild(this.fileInput)
  },
  beforeDestroy () {
    this.cancelAll()
  },
  methods: {
    preview (index) {
      let successFileIndex = findIndex(
        this.successFiles,
        val => val[this.keyField] === this.fileList[index].key
      )
      this.previewIndex = successFileIndex
      this.previewOpen = true
    },
    cancelAll () {
      this.fileList.forEach(file => file.cancel())
    },
    clear () {
      this.fileList.forEach((file, index) => {
        if (file.isFailure) {
          this.removeFile(this.fileList.indexOf(file))
        }
      })
    },
    prune () {
      this.fileList.forEach((file, index) => this.removeFile(index))
    },
    focus () {
      this.$el.focus()
    },

    handleItemMove (fromIndex, toIndex) {
      let item = this.fileList[fromIndex]
      this.fileList.splice(fromIndex, 1)
      if (toIndex > fromIndex) {
        toIndex--
      }
      this.fileList.splice(toIndex, 0, item)
      this.$emit('change', this.getValueForChange(this.successFiles))
    },

    handleItemAdd () {
      this.chooseFiles()
    },
    handleItemRemove (index) {
      this.removeFile(index)
    },
    handleItemReplace (index) {
      // TODO: pickFiles 异步回调后可能 fileList index 已经变了
      this.pickFiles(false).then(files => {
        this.replaceFile(index, files[0])
      })
    },
    handleItemPreview (index) {
      this.preview(index)
    },
    handleItemCustomEvent (name, index) {
      if (isUndefined(index)) {
        return this.$emit(name)
      }
      this.$emit(name, this.getValueWithStatus(this.fileList[index]))
    },

    createInputElement () {
      let el = document.createElement('input')
      el.type = 'file'
      el.hidden = true
      return el
    },
    pickFiles (multiple) {
      if (this.removePreviousFileInputHandler) {
        this.removePreviousFileInputHandler()
      }

      let input = this.fileInput
      input.accept = this.realAccept
      input.multiple = this.canMultipleChoose && multiple

      let cancelFunctions = []
      let promise = new Promise((resolve, reject) => {
        let remove = addOnceEventListener(input, 'change', ({ target }) => {
          let files = [...target.files]
          if (!this.canMultipleChoose) {
            // IE 11 兼容: 保留 input 和 FileList
            let file = files[0]
            file._rawFileList = target.files
            files = [file]
            input = this.fileInput = this.createInputElement()
          }
          resolve(files)
          input.value = null
        })
        cancelFunctions.push(remove)
        cancelFunctions.push(reject)
      })
      this.removePreviousFileInputHandler = () =>
        cancelFunctions.forEach(c => c())

      input.click()
      return !this.afterPick
        ? promise
        : promise.then(files => this.afterPick(files))
    },
    chooseFiles () {
      let restCount = this.maxCount - this.fileList.length
      this.pickFiles(restCount > 1)
        .then(files => {
          if (!files.length) {
            return
          }
          this.addFiles(files)
        })
        .catch(noop)
    },
    addFiles (files) {
      const count = this.fileList.length + files.length
      if (count > this.maxCount) {
        const message = this.t('tooManyFiles')
        toast.error(message)
        this.$emit('invalid', {
          errors: [
            {
              type: ERRORS.TOO_MANY_FILES,
              value: count,
              message
            }
          ]
        })
        return
      }
      files = files.map(file => this.createUploaderFile(file))
      this.fileList =
        this.realOrder === ORDERS.PREPEND
          ? files.concat(this.fileList)
          : this.fileList.concat(files)

      if (this.autoupload) {
        this.triggerUpload()
      }
    },
    triggerUpload () {
      this.fileList.forEach(file => this.uploadFile(file))
    },
    uploadFile (file) {
      if (!file.isPending) {
        return
      }

      file.isUploading = true
      return file
        .validate(this.validateOptions, this)
        .then(errors => {
          if (!errors) {
            return
          }
          this.$emit('invalid', { file: file.native, errors })
          file.message = errors
            .map(({ message }) => message)
            .join(this.t('separator'))
          throw new Error('validate failed') // skip to next catch block
        })
        .then(() => {
          // validate success, start to upload
          return file.upload(this, {
            onprogress: evt => {
              if (evt.loaded < 0) {
                return
              }
              this.$emit(
                'progress',
                this.getValueWithStatus(file),
                this.fileList.indexOf(file),
                evt
              )
            },
            oncancel: () =>
              this.removeFile(this.fileList.indexOf(file), { restore: true })
          })
        })
        .then(() => STATUS.SUCCESS)
        .catch(err => {
          if (err.__CANCEL__) {
            throw err
          }
          return STATUS.FAILURE
        })
        .then(status => {
          this.updateFileStatus(this.fileList.indexOf(file), status)
        })
        .catch(function (err) {
          if (process.env.NODE_ENV === 'development') {
            console.log('Upload file exception: ', err)
          }
        })
    },
    updateFileStatus (index, status) {
      if (index < 0 || index >= this.fileList.length) {
        return
      }
      const isSuccess = status === STATUS.SUCCESS
      // 需要保证事件顺序：先 change，再 statuschange (重构前逻辑)
      // 修改 file.status 就会触发 watch:status emit statuschange
      // 因此需要先在局部构造 change value，触发 change 后，再修改 file.status
      let successFiles = this.fileList
        .map((file, i) => {
          if ((i === index && isSuccess) || file.isSuccess) {
            return file.value
          }
        })
        .filter(Boolean)

      if (isSuccess) {
        this.$emit('change', this.getValueForChange(successFiles))
      }
      this.$emit(status, { ...this.fileList[index].value, status }, index)
      this.fileList[index].status = status
    },
    replaceFile (index, file) {
      let newFile = this.createUploaderFile(file)
      newFile._replacing = this.fileList.splice(index, 1, newFile)[0]
      this.uploadFile(newFile)
    },
    removeFile (index, { restore = false } = {}) {
      if (index < 0 || index >= this.fileList.length) {
        return
      }

      let file = this.fileList[index]
      file.cancel()

      let files = this.fileList
        .map(function (file, i) {
          if (i === index) {
            return restore && file._replacing ? file._replacing : null
          }
          return file
        })
        .filter(Boolean)

      // 跟 updateFileStatus 相同，也需要保证顺序
      if (file.isSuccess || (restore && file._replacing)) {
        let successFiles = files
          .map(function (file) {
            return file.isSuccess ? file.value : null
          })
          .filter(Boolean)
        this.$emit('change', this.getValueForChange(successFiles))
      }

      this.$emit('remove', this.getValueWithStatus(file), index)
      this.fileList = files
    },

    getValueForChange (files) {
      return this.realMultiple ? files : files[0] || null
    },
    getValueWithStatus (file) {
      return { ...file.value, status: file.status }
    },
    guessFileType (val) {
      return this.preferType || getFileMediaType(val)
    },
    createUploaderFile (val, file) {
      const options = { keyField: this.keyField }
      if (val instanceof File) {
        return new UploaderFile(val, options)
      }

      if (file) {
        file.keyField = this.keyField
        file.value = val
      } else {
        file = UploaderFile.fromValue(val, options)
      }
      let guessType = this.guessFileType(val)
      if (!val.type && guessType !== file.type) {
        file.type = guessType
      }
      return file
    },

    // legacy APIs
    clickInput () {
      warn(
        '[veui-uploader] `clickInput` is deprecated. use `chooseFiles` instead',
        this
      )
      this.chooseFiles()
    },
    submit (file) {
      warn(
        '[veui-uploader] `submit` is deprecated. use `triggerUpload` instead',
        this
      )
      let internalFile = find(
        this.fileList,
        item => item[this.keyField] === file[this.keyField]
      )
      if (internalFile) {
        this.uploadFile(internalFile)
      }
    },
    uploadFiles () {
      warn(
        '[veui-uploader] `uploadFiles` is deprecated. use `triggerUpload` instead',
        this
      )
      this.triggerUpload()
    }
  }
}
</script>
