const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const FormData = require('form-data');

let CONFIG = {};

function getKrasnoyarskDate() {
    const now = new Date();
    const krasnoyarskOffset = 7 * 60;
    const localOffset = now.getTimezoneOffset();
    const krasnoyarskTime = new Date(now.getTime() + (krasnoyarskOffset + localOffset) * 60000);
    return krasnoyarskTime;
}

function getKrasnoyarskDateString() {
    return getKrasnoyarskDate().toISOString().split('T')[0];
}

function formatKrasnoyarskDate() {
    const date = getKrasnoyarskDate();
    return date.toLocaleDateString('ru-RU', {
        timeZone: 'Asia/Krasnoyarsk',
        day: 'numeric',
        month: 'long'
    });
}

function getFormattedKrasnoyarskDate() {
    const date = getKrasnoyarskDate();
    return date.toLocaleDateString('ru-RU', {
        timeZone: 'Asia/Krasnoyarsk',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

async function loadConfig() {
    try {
        const data = await fs.readFile('config.json', 'utf8');
        CONFIG = JSON.parse(data);
        console.log('✅ Конфигурация загружена из config.json');
        return true;
    } catch (error) {
        console.error('❌ Ошибка загрузки конфигурации:', error.message);
        return false;
    }
}

async function checkAndCreateLock() {
    const todayFormatted = getFormattedKrasnoyarskDate();
    
    try {
        let lockContent;
        try {
            lockContent = await fs.readFile(CONFIG.lockFile, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.writeFile(CONFIG.lockFile, todayFormatted, 'utf8');
                console.log(`✅ Файл блокировки создан: ${todayFormatted}`);
                return true;
            } else {
                console.error('❌ Ошибка чтения файла блокировки:', error.message);
                return false;
            }
        }

        if (lockContent.trim() === todayFormatted) {
            console.log(`❌ Скрипт уже был запущен сегодня (${todayFormatted}). Повторный запуск запрещен.`);
            return false;
        } else {
            await fs.writeFile(CONFIG.lockFile, todayFormatted, 'utf8');
            console.log(`✅ Файл блокировки обновлен: ${todayFormatted}`);
            return true;
        }
        
    } catch (error) {
        console.error('Ошибка при работе с файлом блокировки:', error.message);
        return false;
    }
}

async function getGroupId(groupId) {
    try {
        if (groupId.startsWith('-')) {
            return groupId;
        }

        const response = await axios.get('https://api.vk.com/method/groups.getById', {
            params: {
                group_ids: groupId,
                access_token: CONFIG.accessToken,
                v: CONFIG.apiVersion
            }
        });

        if (response.data.error) {
            throw new Error(`Ошибка получения ID группы: ${response.data.error.error_msg}`);
        }

        const groupInfo = response.data?.response?.groups?.[0];
        
        if (!groupInfo) {
            throw new Error('Группа не найдена. Проверьте корректность groupId.');
        }

        return `-${groupInfo.id}`;

    } catch (error) {
        console.error('❌ Ошибка при получении ID группы:', error.message);
        throw error;
    }
}

async function getAllGroupMembers(groupId) {
    let allMembers = [];
    let offset = 0;
    const count = 1000;

    try {
        while (true) {
            const response = await axios.get('https://api.vk.com/method/groups.getMembers', {
                params: {
                    group_id: groupId,
                    fields: 'bdate,first_name,last_name',
                    offset: offset,
                    count: count,
                    access_token: CONFIG.accessToken,
                    v: CONFIG.apiVersion
                }
            });

            if (response.data.error) {
                throw new Error(`Ошибка API: ${response.data.error.error_msg}`);
            }

            const members = response.data.response.items;
            allMembers = allMembers.concat(members);

            if (members.length === 0 || offset + count >= response.data.response.count) {
                break;
            }

            offset += count;
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    } catch (error) {
        console.error('Ошибка при получении участников:', error.message);
        throw error;
    }

    return allMembers;
}

function isBirthdayToday(bdate) {
    if (!bdate) return false;

    const dateParts = bdate.split('.');
    if (dateParts.length < 2) return false;

    const today = getKrasnoyarskDate();
    const userDay = parseInt(dateParts[0]);
    const userMonth = parseInt(dateParts[1]) - 1;

    return today.getDate() === userDay && today.getMonth() === userMonth;
}

function createCongratulationsPost(birthdayPeople) {
    const formattedDate = formatKrasnoyarskDate();

    let postText = `🎉 ${formattedDate}\n\nСегодня день рождения празднуют:\n\n`;

    if (birthdayPeople.length === 0) {
        postText = `📅 ${formattedDate}\n\nСегодня именинников нет 😔`;
    } else {
        birthdayPeople.forEach((person) => {
            postText += `@id${person.id} (${person.first_name} ${person.last_name})\n`;
        });
        
        postText += '\n💐 Присоединяйтесь к поздравлениям в комментариях!\n';
        postText += '🎂 Желаем счастья, здоровья и успехов!';
    }

    return postText;
}

async function getImageFromGoogleSearch() {
    try {
        if (!CONFIG.googleSearch.apiKey || !CONFIG.googleSearch.searchEngineId) {
            console.log('⚠️ API ключ или ID поискового движка не указаны в config.json');
            return null;
        }

        const searchUrl = 'https://www.googleapis.com/customsearch/v1';
        const params = {
            key: CONFIG.googleSearch.apiKey,
            cx: CONFIG.googleSearch.searchEngineId,
            q: CONFIG.googleSearch.query || 'красивые поздравительные открытки с днем рождения',
            searchType: 'image',
            imgSize: 'large',
            num: 10,
            safe: 'active'
        };

        console.log(`🔍 Ищем изображения по запросу: "${params.q}"`);
        
        const response = await axios.get(searchUrl, {
            params: params,
            timeout: 15000
        });

        if (!response.data.items || response.data.items.length === 0) {
            console.log('❌ По запросу не найдено изображений');
            return null;
        }

        const randomIndex = Math.floor(Math.random() * response.data.items.length);
        const imageUrl = response.data.items[randomIndex].link;
        
        console.log(`📥 Загружаем изображение: ${new URL(imageUrl).hostname}`);

        const imageResponse = await axios({
            method: 'GET',
            url: imageUrl,
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        console.log('✅ Изображение успешно загружено из Google Search');
        return Buffer.from(imageResponse.data);
        
    } catch (error) {
        if (error.response && error.response.status === 429) {
            console.log('❌ Превышен лимит запросов к Google API');
        } else if (error.response) {
            console.log(`❌ Ошибка Google API: ${error.response.status} - ${error.response.data.error?.message}`);
        } else {
            console.log(`❌ Ошибка при загрузке из Google: ${error.message}`);
        }
        return null;
    }
}

async function getImageFromLocalFolder() {
    try {
        const imagesDir = path.join(__dirname, 'images');
        
        const files = await fs.readdir(imagesDir);
        
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'];
        const imageFiles = files.filter(file => 
            imageExtensions.includes(path.extname(file).toLowerCase())
        );

        if (imageFiles.length === 0) {
            console.log('❌ В папке images нет подходящих изображений');
            return null;
        }

        const randomImage = imageFiles[Math.floor(Math.random() * imageFiles.length)];
        const imagePath = path.join(imagesDir, randomImage);
        
        console.log(`🖼 Выбрано локальное изображение: ${randomImage}`);
        
        const imageBuffer = await fs.readFile(imagePath);
        console.log('✅ Изображение загружено из локальной папки');
        return imageBuffer;
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('❌ Папка images не существует');
        } else {
            console.error('❌ Ошибка при чтении локального изображения:', error.message);
        }
        return null;
    }
}

async function createImageBuffer() {
    if (CONFIG.googleSearch && CONFIG.googleSearch.enable) {
        console.log('🔍 Пробуем найти изображение через Google Search...');
        const googleImageBuffer = await getImageFromGoogleSearch();
        if (googleImageBuffer) {
            return googleImageBuffer;
        }
        
        if (CONFIG.googleSearch.fallbackToLocal !== false) {
            console.log('🔄 Переключаемся на локальные изображения...');
        }
    }

    return await getImageFromLocalFolder();
}

async function publishPostToGroup(ownerId, postText, imageBuffer) {
    let attachments = '';

    try {
        if (imageBuffer) {
            console.log('🔄 Загружаем изображение из памяти на сервер VK...');
            
            const uploadServerResponse = await axios.get(
                'https://api.vk.com/method/photos.getWallUploadServer', {
                    params: {
                        group_id: Math.abs(parseInt(ownerId)),
                        access_token: CONFIG.accessToken,
                        v: CONFIG.apiVersion
                    }
                }
            );

            if (uploadServerResponse.data.error) {
                throw new Error(`Ошибка получения сервера загрузки: ${uploadServerResponse.data.error.error_msg}`);
            }

            const uploadServer = uploadServerResponse.data.response;
            
            const formData = new FormData();
            formData.append('photo', imageBuffer, {
                filename: 'birthday.jpg',
                contentType: 'image/jpeg'
            });

            console.log('📤 Отправляем изображение из памяти на сервер VK...');
            const uploadResponse = await axios.post(
                uploadServer.upload_url,
                formData,
                {
                    headers: {
                        ...formData.getHeaders()
                    },
                    timeout: 30000
                }
            );

            console.log('💾 Сохраняем фото в альбом группы...');
            const saveResponse = await axios.get(
                'https://api.vk.com/method/photos.saveWallPhoto', {
                    params: {
                        group_id: Math.abs(parseInt(ownerId)),
                        server: uploadResponse.data.server,
                        photo: uploadResponse.data.photo,
                        hash: uploadResponse.data.hash,
                        access_token: CONFIG.accessToken,
                        v: CONFIG.apiVersion
                    }
                }
            );

            if (saveResponse.data.error) {
                throw new Error(`Ошибка сохранения фото: ${saveResponse.data.error.error_msg}`);
            }

            const photo = saveResponse.data.response[0];
            attachments = `photo${photo.owner_id}_${photo.id}`;
            console.log('✅ Изображение загружено в VK прямо из памяти');
        }

        const postParams = {
            owner_id: ownerId,
            from_group: CONFIG.fromGroup,
            message: postText,
            access_token: CONFIG.accessToken,
            v: CONFIG.apiVersion
        };

        if (attachments) {
            postParams.attachments = attachments;
        }

        console.log('📝 Публикуем пост...');
        const response = await axios.post(
            'https://api.vk.com/method/wall.post',
            new URLSearchParams(postParams),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 15000
            }
        );

        if (response.data.error) {
            throw new Error(`Ошибка API при публикации: ${response.data.error.error_msg}`);
        }

        console.log('✅ Пост успешно опубликован в группу!');
        return response.data.response;

    } catch (error) {
        console.error('❌ Ошибка при публикации поста:', error.message);
        
        console.log('🔄 Пытаемся опубликовать пост без изображения...');
        try {
            const postParams = {
                owner_id: ownerId,
                from_group: CONFIG.fromGroup,
                message: postText,
                access_token: CONFIG.accessToken,
                v: CONFIG.apiVersion
            };

            const response = await axios.post(
                'https://api.vk.com/method/wall.post',
                new URLSearchParams(postParams),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: 15000
                }
            );

            if (response.data.error) {
                throw new Error(`Ошибка API при публикации: ${response.data.error.error_msg}`);
            }

            console.log('✅ Пост без изображения успешно опубликован!');
            return response.data.response;
        } catch (fallbackError) {
            console.error('❌ Не удалось опубликовать даже пост без изображения:', fallbackError.message);
            throw error;
        }
    }
}

async function resetLock() {
    try {
        await fs.access(CONFIG.lockFile);
        const lockContent = await fs.readFile(CONFIG.lockFile, 'utf8');
        await fs.unlink(CONFIG.lockFile);
        console.log(`✅ Блокировка сброшена (была установлена на: ${lockContent.trim()})`);
    } catch (error) {
        console.log('ℹ️ Файл блокировки не существует');
    }
}

async function showLockStatus() {
    try {
        const lockContent = await fs.readFile(CONFIG.lockFile, 'utf8');
        const todayFormatted = getFormattedKrasnoyarskDate();
        
        console.log(`📅 Дата в lock файле: ${lockContent.trim()}`);
        console.log(`🌏 Сегодняшняя дата: ${todayFormatted}`);
        
        if (lockContent.trim() === todayFormatted) {
            console.log('🔒 Скрипт сегодня уже запускался');
        } else {
            console.log('🔓 Скрипт сегодня еще не запускался');
        }
    } catch (error) {
        console.log('ℹ️ Файл блокировки не существует');
    }
}

async function showHelp() {
    console.log(`
🎂 VK Birthday Bot - Помощь

Использование:
  node index.js           - Запустить основной скрипт
  node index.js --reset   - Сбросить блокировку
  node index.js --status  - Показать статус блокировки
  node index.js --help    - Показать эту справку

Описание:
  Скрипт автоматически находит участников группы с днем рождения сегодня
  и публикует поздравительный пост на стену группы.
  Работает по Красноярскому времени (UTC+7).

  Текущее красноярское время: ${getKrasnoyarskDate().toLocaleString('ru-RU', {timeZone: 'Asia/Krasnoyarsk'})}
    `);
}

async function main() {
    if (!(await loadConfig())) {
        return;
    }

    if (process.argv.includes('--reset')) {
        await resetLock();
        return;
    }

    if (process.argv.includes('--status')) {
        await showLockStatus();
        return;
    }

    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        await showHelp();
        return;
    }

    console.log(`🌏 Текущее красноярское время: ${getKrasnoyarskDate().toLocaleString('ru-RU', {timeZone: 'Asia/Krasnoyarsk'})}`);

    if (!(await checkAndCreateLock())) {
        return;
    }

    console.log('🔄 Получаем числовой ID группы...');
    const numericGroupId = await getGroupId(CONFIG.groupId);
    console.log(`✅ ID группы: ${numericGroupId}`);

    console.log('🔄 Получаем список участников группы...');
    const members = await getAllGroupMembers(CONFIG.groupId);
    console.log(`✅ Всего участников получено: ${members.length}`);

    const birthdayPeople = members.filter(member => isBirthdayToday(member.bdate));

    console.log('\n🎂 Сегодня день рождения у:');
    if (birthdayPeople.length === 0) {
        console.log('Именинников нет 😔');
    } else {
        birthdayPeople.forEach(person => {
            console.log(`- @id${person.id} (${person.first_name} ${person.last_name})`);
        });
    }

    console.log('\n📝 Создаем пост с поздравлениями...');
    const postText = createCongratulationsPost(birthdayPeople);
    
    console.log('\n🖼 Загружаем изображение...');
    const imageBuffer = await createImageBuffer();
    
    console.log('\n📋 Текст поста:');
    console.log('---');
    console.log(postText);
    console.log('---');
    
    try {
        await publishPostToGroup(numericGroupId, postText, imageBuffer);
    } catch (error) {
        console.error('❌ Не удалось опубликовать пост');
        return;
    }

    return birthdayPeople;
}

process.on('unhandledRejection', (error) => {
    console.error('❌ Необработанное исключение:', error);
    process.exit(1);
});

main()
    .then(() => {
        console.log('\n✅ Скрипт завершил работу');
        console.log(`🌏 Красноярское время завершения: ${getKrasnoyarskDate().toLocaleString('ru-RU', {timeZone: 'Asia/Krasnoyarsk'})}`);
    })
    .catch(error => {
        console.error('❌ Критическая ошибка:', error);
        process.exit(1);
    });

