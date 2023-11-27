const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs')
const path = require('path')
const hirestime = require('hirestime')

/**
 * 统计耗时
  {
    "hmt_1": "241.72ms",
    "hmt_2": "461.95ms",
    "hmt_3": "4345.94ms",
    "province": "57.04ms",
    "city": "5747.06ms",
    "county": "76178.08ms",
    "town": "1361214.51ms",
    "total": "1448460.71ms"
  }
*/

;(function () {
  const url = 'http://www.stats.gov.cn/sj/tjbz/tjyqhdmhcxhfdm'
  const hmtUrl = 'https://query.aliyun.com/rest/sell.getDivisions' //阿里云控制台新增地址
  const year = 2023
  const matchFields = {
    1: 'province',
    2: 'city',
    3: 'county',
    4: 'town',
    // 5: 'village', //耗时时间太长
  }
  const matchHMTFields = {
    1: 'hmt_1',
    2: 'hmt_2',
    3: 'hmt_3',
  }
  const mergeMatchFields = [
    ...Object.values(matchFields),
    ...Object.values(matchHMTFields),
  ]
  const matchClassNames = {
    //对应的class名
    1: 'provincetr',
    2: 'citytr',
    3: 'countytr',
    4: 'towntr',
    5: 'villagetr',
  }

  function readFile(dir, defaultValue) {
    const pathFile = path.resolve(__dirname, dir)
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(pathFile)) {
        return resolve(defaultValue || {})
      }
      fs.readFile(dir, 'utf-8', (err, data) => {
        if (err) {
          reject(err)
        } else {
          resolve(data ? JSON.parse(data) : defaultValue || {})
        }
      })
    })
  }

  function flatten(data) {
    return data.flatMap((item) => item)
  }

  function isVaildArray(data) {
    return Array.isArray(data) && Boolean(data.length)
  }

  function sleep(d) {
    const t = new Date().getTime()
    while (new Date().getTime() - t <= d) {}
  }

  function getTempJsonFile(name) {
    return `./temp/${year}/${name}.json`
  }

  function getDataJsonFile(name) {
    return `./data/${year}/${name}.json`
  }

  function request(opts) {
    return new Promise((resolve, reject) => {
      axios({
        maxRedirects: 0,
        ...opts,
      })
        .then((response) => {
          resolve({
            ...response,
            isOk: response.status === 200,
          })
        })
        .catch((err) => {
          console.log(err)
          reject(err)
        })
    })
  }

  return {
    async init() {
      const { NODE_ENV } = process.env
      try {
        if (NODE_ENV == 'build') {
          return await this.build()
        }
        if (NODE_ENV == 'compress') {
          return await this.compress()
        }
        const getElapsed = hirestime()

        /* 获取香港、澳门、台湾 */
        const HMTData_1 = await this.getHMTData()
        const HMTData_2 = await this.getHMTNextData(HMTData_1, 2)
        const HMTData_3 = await this.getHMTNextData(HMTData_2, 3)

        const provinceData = await this.getProvince()
        const cityData = await this.getNextData(provinceData)
        const countyData = await this.getNextData(cityData, 3)
        const townData = await this.getNextData(countyData, 4)
        const villageData = await this.getNextData(townData, 5)

        await this.writeExecTime(0, getElapsed.ms())
      } catch (error) {
        console.log('error', error)
      }
    },
    async build() {
      const info = {}
      for (let index = 0; index < mergeMatchFields.length; index++) {
        const field = mergeMatchFields[index]
        let data = await readFile(getTempJsonFile(field))
        data = flatten(Object.values(data)).map(
          ({
            name,
            code,
            province = {},
            city = {},
            county = {},
            town = {},
          }) => ({
            name,
            code,
            province: province.code,
            city: city.code,
            county: county.code,
            town: town.code,
          })
        )
        info[field] = data
        await this.writeData({ data: data, dir: 'data', fileName: field })
      }
      const treeData = await this.buildTree({
        data: [...info[matchFields[1]], ...info[matchHMTFields[1]]],
        maxLevel: Object.values(matchFields).length,
      })
      await this.writeData({
        data: treeData,
        dir: 'data',
        fileName: 'tree',
      })
    },
    async compress() {
      for (let index = 0; index < mergeMatchFields.length; index++) {
        const field = mergeMatchFields[index]
        let tempJson = await readFile(getTempJsonFile(field))
        let dataJson = await readFile(getDataJsonFile(field))
        await this.writeData({
          data: tempJson,
          dir: 'temp',
          fileName: `${field}.min`,
          space: 0,
        })
        await this.writeData({
          data: dataJson,
          dir: 'data',
          fileName: `${field}.min`,
          space: 0,
        })
      }
      await this.writeData({
        data: await readFile(getDataJsonFile('tree')),
        dir: 'data',
        fileName: `tree.min`,
        space: 0,
      })
    },
    async buildTree(opts) {
      const { data = [], level = 2, maxLevel = 1, cache = {} } = opts
      for (let index = 0; index < mergeMatchFields.length; index++) {
        const name = mergeMatchFields[index]
        cache[name] = cache[name] || (await readFile(getTempJsonFile(name)))
      }
      const info = cache[matchFields[level]] || {}
      const infoHMT = cache[matchHMTFields[level]] || {}
      for (let index = 0; index < data.length; index++) {
        const item = data[index]
        mergeMatchFields.forEach((cur) => {
          if (item[cur]) {
            item[cur] = item[cur].code
          }
        })
        item.url = void 0
        if (level > maxLevel) {
          continue
        }
        const nextData = info[item.code] || infoHMT[item.code]
        item.children = await this.buildTree({
          ...opts,
          data: nextData,
          level: level + 1,
          cache,
        })
        if (!item.children.length) {
          item.children = void 0
        }
      }
      return data
    },
    async getHMTData() {
      const level = 1
      const getElapsed = hirestime()
      const name = matchHMTFields[level]
      let result = await readFile(getTempJsonFile(name), [])
      if (!isVaildArray(result)) {
        result = await this.getHMT(1, { level })
      }
      await this.writeExecTime(level, getElapsed.ms(), true)
      await this.writeData({ data: result, fileName: name })
      return result
    },
    async getHMTNextData(data, level = 2) {
      const getElapsed = hirestime()
      const name = matchHMTFields[level]
      if (!name) {
        return []
      }
      const result = await readFile(getTempJsonFile(name))
      const error = {}
      for (let index = 0; index < data.length; index++) {
        const item = data[index]
        if (result[item.code]) {
          continue
        }
        try {
          const extra = {
            2: {
              province: item,
            },
            3: {
              province: item.province,
              city: item,
            },
          }[level]
          item.province = void 0
          item.city = void 0
          const response = await this.getHMT(item.code, {
            level,
            extra,
          })
          result[item.code] = response
        } catch (err) {
          error[item.code] = err.opts
        }
        await this.writeData({
          data: result,
          fileName: name,
          message: `数据【${item.name}】输出成功！`,
        })
        await this.writeData({
          data: error,
          fileName: `${name}_error`,
          message: `数据【${item.name}】Error 输出成功！`,
        })
      }
      await this.writeExecTime(level, getElapsed.ms(), true)
      return flatten(Object.values(result))
    },
    getHMT(id, { level, extra = {} }) {
      return new Promise((resolve, reject) => {
        request({
          url: `${hmtUrl}?id=${id}`,
        })
          .then(async (response) => {
            if (!response.isOk) {
              return reject({
                response,
                opts: {
                  id,
                  ...extra,
                },
              })
            }
            let data = response.data.data || []
            if (level == 1) {
              //港澳台对应code
              data = data.filter((item) =>
                ['810000', '820000', '710000'].includes(item.regionId)
              )
            }
            resolve(
              data.map((item) => ({
                code: item.regionId,
                name: item.names.CN,
                ...extra,
              }))
            )
          })
          .catch((response) => {
            reject({
              response,
              opts: {
                id,
                ...extra,
              },
            })
          })
      })
    },
    async getProvince() {
      const level = 1
      const getElapsed = hirestime()
      const name = matchFields[level]
      let result = await readFile(getTempJsonFile(name), [])
      if (!isVaildArray(result)) {
        result = await this.getData('index.html', {
          level,
        })
      }
      await this.writeExecTime(level, getElapsed.ms())
      await this.writeData({ data: result, fileName: name })
      return result
    },
    async getNextData(data, level = 2) {
      const getElapsed = hirestime()
      const name = matchFields[level]
      if (!name) {
        return []
      }
      const result = await readFile(getTempJsonFile(name))
      const noChildName = 'no_child'
      const noChildResult = await readFile(getTempJsonFile(noChildName)) //整合没有下级的数据，方便比较是否获取数据失败
      const error = {}
      for (let index = 0; index < data.length; index++) {
        const item = data[index]
        if (result[item.code]) {
          continue
        }
        sleep(100)
        console.log('当前进度', `${index}/${data.length}`)
        try {
          const extra = {
            2: {
              province: item,
            },
            3: {
              province: item.province,
              city: item,
            },
            4: {
              province: item.province,
              city: item.city,
              county: item,
            },
            5: {
              province: item.province,
              city: item.city,
              county: item.county,
              town: item,
            },
          }[level]
          item.province = void 0
          item.city = void 0
          item.county = void 0
          item.town = void 0
          const response = await this.getData(item.url, {
            level,
            currentLevel: level,
            extra,
          })
          result[item.code] = response
          if (!isVaildArray(response) && level != 5) {
            //第5级没有下级
            noChildResult[item.code] = extra
          }
        } catch (err) {
          console.log('🚀 ~ file: main.js:331 ~ getNextData ~ err:', err)
          error[item.code] = err.opts
        }
        await this.writeData({
          data: result,
          fileName: name,
          message: `数据【${item.name}】输出成功！`,
        })
        await this.writeData({
          data: noChildResult,
          fileName: noChildName,
          message: `数据【${noChildName}】输出成功！`,
        })
        await this.writeData({
          data: error,
          fileName: `${name}_error`,
          message: `数据【${item.name}】Error 输出成功！`,
        })
      }
      await this.writeExecTime(level, getElapsed.ms())
      return flatten(Object.values(result))
    },
    async writeExecTime(level = 1, time, isHMT) {
      const name =
        {
          0: 'total',
        }[level] || (isHMT ? matchHMTFields : matchFields)[level]
      const result = await readFile(getTempJsonFile('exec_time'))
      result[name] = `${time}ms`
      await this.writeData({
        data: result,
        fileName: 'exec_time',
      })
    },
    writeData({ data, dir = 'temp', fileName, message, space = 2 }) {
      const name = `${fileName}.json`
      return new Promise((resolve, reject) => {
        const baseUrl = path.dirname(`${dir}/${year}/.`)
        if (!fs.existsSync(baseUrl)) {
          fs.mkdirSync(baseUrl, { recursive: true })
        }
        fs.writeFile(
          `${baseUrl}/${name}`,
          JSON.stringify(data, null, space),
          (err) => {
            if (err) {
              console.log(err)
              reject()
            } else {
              console.log(message || `数据${name}输出成功！`)
              resolve()
            }
          }
        )
      })
    },
    splitUrl(level, url) {
      //根据链接规则拼接成地址 例：632725203.html => 63/27/25/632725203.html
      if (level < 3) {
        return url
      }
      url = url.split('/').slice(-1)[0]
      return (
        Array.prototype.reduce
          .call(
            url,
            (info, item, index) => {
              if (index && index % 2 == 0 && info.length < level - 2) {
                info.push(url.substring(index - 2, index))
              }
              return info
            },
            []
          )
          .join('/') + `/${url}`
      )
    },
    getData(link, opts = {}) {
      opts.extra = opts.extra || {}
      return new Promise((resolve, reject) => {
        if (!link || (opts.cacheLevel && opts.level > opts.cacheLevel)) {
          return resolve([])
        }
        opts.cacheLevel = opts.cacheLevel || opts.level
        opts.currentLevel = opts.currentLevel || 1
        link = this.splitUrl(opts.currentLevel, link)
        let className = matchClassNames[opts.currentLevel]
        request({
          url: `${url}/${year}/${link}`,
        })
          .then(async (response) => {
            // 测试失败场景
            // if (!response.isOk || (opts.extra.province || {}).code == 120000000000) {
            if (!response.isOk) {
              console.log('失败--', link, opts)
              return reject({
                response,
                opts: {
                  link,
                  ...opts.extra,
                },
              })
            }
            const $ = cheerio.load(response.data)
            //广东省东莞市、中山市，海南省儋州市下级区的结构跟其它不一致，需将countytr换成towntr单独处理
            const { city: extraCity } = opts.extra
            if (
              className == 'countytr' &&
              extraCity &&
              ['441900000000', '442000000000', '460400000000'].includes(
                extraCity.code
              )
            ) {
              className = 'towntr'
            }
            const $tr = $(`.${className}`)
            const isProvince = opts.currentLevel == 1
            const $doc = isProvince ? $tr.find('td') : $tr
            const data = []
            for (let index = 0; index < $doc.length; index++) {
              const item = $doc[index]
              const $td = isProvince ? $(item) : $(item).find('td')
              const $elName = isProvince ? $td : $td.last()
              const link = $elName.find('a').attr('href')
              const res = {
                name: $elName.text().replace(/^\s+|\s+$/g, ''),
                url: link,
                ...(opts.level == 5 && {
                  classCode: $td.eq(1).text(),
                }), //城乡分类代码
                ...opts.extra,
              }
              res.code = isProvince
                ? link.split('.')[0] + '0000000000'
                : $td
                    .first()
                    .text()
                    .replace(/^\s+|\s+$/g, '')
              // console.log('抓取--', link, res.name, `${index}/${$doc.length}`);
              /* //此处可递归生成数据，因效率低，已废弃
              let children = []
              if (link) {
                if (!index) {
                  opts.currentLevel += 1
                }
                try {
                  children = await this.getData(link, {
                    ...opts,
                    level: opts.currentLevel,
                    name: res.name
                  })
                } catch (error) {
                }
              }
              if (children.length) {
                res.children = children
              }  */
              data.push(res)
            }
            resolve(data)
          })
          .catch((response) => {
            reject({
              response,
              opts: {
                link,
                ...opts.extra,
              },
            })
          })
      })
    },
  }.init()
})()
