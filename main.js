'use strict';

// 変数のグローバル定義
let replayController;
let canvasToToio;

class BluetoothController {
    /*
    ======================
    Characteristic UUIDを設定
    ======================
    */
    static TOIO_SERVICE_UUID = "10b20100-5b3b-4571-9508-cf3efcd7bbae";
    static MOTOR_CHARACTERISTIC_UUID = "10b20102-5b3b-4571-9508-cf3efcd7bbae";
    static ID_SENSOR_CHARACTERISTICS_UUID = '10b20101-5b3b-4571-9508-cf3efcd7bbae';
    static EulerianAngles_CHARACTERISTICS_UUID = '10b20106-5b3b-4571-9508-cf3efcd7bbae';
    static CONFIGURATION_CHARACTERISTIC_UUID = '10b201ff-5b3b-4571-9508-cf3efcd7bbae';

    /*
    ======================
    モーター特性の応答を待ち受ける
    * 応答タイプ:
    * - 0x83: 目標指定付きモーター制御の応答
    * - 0x84: 複数目標指定付きモーター制御の応答
    * - 0xe0: モーターの速度情報の取得
    ======================
    */
    static RESPONSE_TYPES = {
        TARGET_MOTOR_CONTROL: 0x83,
        MULTIPLE_TARGET_MOTOR_CONTROL: 0x84,
        MOTOR_SPEED_INFO: 0xe0
    };

    constructor() {
        this.devices = new Map();
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // toio接続
        document.getElementById('connectButton').addEventListener('click', () => this.connect());
        // toio切断
        document.getElementById('disconnectButton').addEventListener('click', () => this.disconnect());
    }

    async connect() {
        try {
            console.log("Requesting Bluetooth Device...");
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [BluetoothController.TOIO_SERVICE_UUID] }]
            });

            console.log("Connecting to GATT Server...");
            const server = await device.gatt.connect();

            console.log("Getting Service...");
            const service = await server.getPrimaryService(BluetoothController.TOIO_SERVICE_UUID);

            console.log("Getting Characteristic...");
            const toio_configuration = await service.getCharacteristic(BluetoothController.CONFIGURATION_CHARACTERISTIC_UUID);
            const motorCharacteristic = await service.getCharacteristic(BluetoothController.MOTOR_CHARACTERISTIC_UUID);
            const sensorCharacteristic = await service.getCharacteristic(BluetoothController.ID_SENSOR_CHARACTERISTICS_UUID);
            const EulerianAnglesCharacteristic = await service.getCharacteristic(BluetoothController.EulerianAngles_CHARACTERISTICS_UUID);

            //デバイスの追加
            this.devices.set(device.id, {
                device: device,
                characteristics: {
                    config: toio_configuration,
                    motor: motorCharacteristic,
                    sensor: sensorCharacteristic,
                    EulerianAngles: EulerianAnglesCharacteristic
                }
            });

            console.log(`Connected to device: ${device.name}`);

            /*--- 接続済一覧に追加 ---*/

            // デバイスリストの親要素を取得
            const deviceList = document.getElementById('device-list');
            // details要素を作成
            const details = document.createElement('details');
            // summary要素を作成してデバイス名を設定
            const summary = document.createElement('summary');
            summary.textContent = device.name;
            // ul要素を作成
            const ul = document.createElement('ul');
            // デバイスIDのli要素を作成
            const idLi = document.createElement('li');
            idLi.textContent = device.id;

            // ul要素にli要素を追加
            ul.appendChild(idLi);

            // details要素にsummary要素とul要素を追加
            details.appendChild(summary);
            details.appendChild(ul);

            // デバイスリストにdetails要素を追加
            deviceList.appendChild(details);


        } catch (error) {
            console.log("Argh! " + error);
        }
    }

    async disconnect() {
        try {
            // デバイスが接続されていない場合
            if (this.devices.size === 0) {
                window.modalController.show('DISCONNECTION');
                return;
            }

            for (let [id, deviceInfo] of this.devices) {
                console.log(`Disconnecting from device: ${deviceInfo.device.name}`);
                await deviceInfo.device.gatt.disconnect();
                console.log(`Disconnected from device: ${deviceInfo.device.name}`);

                // デバイスの削除
                this.devices.delete(id);

                // 接続デバイス一覧からの削除
                const deviceList = document.getElementById('device-list');
                deviceList.querySelectorAll('details').forEach(details => {
                    if (details.querySelector('li').textContent === id) {
                        details.remove();
                    }
                });
            }
        } catch (error) {
            console.log("Argh! " + error);
        }
    }

    // 最初に接続された一台のデバイスのオブジェクトを返す
    getConnectedDevice() {
        if (this.devices.size > 0) {
            return this.devices.values().next().value;
        }
        return null;
    }

    async sendToioCommand(command, characteristicType) {

        if (this.devices.size > 0) {
            if (this.devices.size === 0) {
                throw new Error('デバイスが接続されていません');
            }

            const deviceInfo = this.getConnectedDevice();
            if (!deviceInfo?.characteristics?.[characteristicType]) {
                throw new Error(`${characteristicType} characteristicが見つかりません`);
            }

            try {
                /*
                for (const [deviceId, deviceInfo] of this.devices.entries()) {
                    console.log("Device ID:", deviceId); // デバイスIDをログに出力
                    console.log("Device Info:", deviceInfo); // deviceInfoの内容をログに出力

                    if (deviceInfo.characteristics && deviceInfo.characteristics[characteristicType]) {
                        console.log("Writing command to motor...");
                        await deviceInfo.characteristics[characteristicType].writeValue(command);
                    }
                }
                */

                console.log("Writing command to motor...");
                await deviceInfo.characteristics[characteristicType].writeValue(command);
            } catch (error) {
                console.log('Argh! Error writing command to motor:', error);
                throw error;
            }

        }
    }

    async motorCharacteristicResponse(expectedResponseTypes) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Response timeout'));
            }, 5000);

            const handleCharacteristicValueChanged = (event) => {
                const value = event.target.value;
                if (value.byteLength >= 3) {
                    const controlType = value.getUint8(0);
                    const controlId = value.getUint8(1);
                    const responseContent = value.getUint8(2);

                    if (expectedResponseTypes.includes(controlType)) {
                        clearTimeout(timeoutId);
                        resolve({ controlType, controlId, responseContent });
                    }
                }
            };

            for (const [, deviceInfo] of this.devices) {
                deviceInfo.characteristics.motor.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);
                deviceInfo.characteristics.motor.startNotifications().catch(reject);
            }
        });
    }
}

class PositionController {
    /*
    =============================================
    PositionID読み出し リトルエンディアン形式
    ArrayBuffer(),DataView()を使用する
    データ位置	タイプ	  内容	                      例
    0	          UInt8	  情報の種類	                 0x01（Position ID）
    1	          UInt16	キューブの中心の X 座標値	    0x02c5（709）
    3	          UInt16	キューブの中心の Y 座標値	    0x017f（383）
    5	          UInt16	キューブの角度	             0x0132（306 度）
    7	          UInt16	読み取りセンサーの X 座標値	  0x02bc（700）
    9	          UInt16	読み取りセンサーの Y 座標値	  0x0182（386）
    11	        UInt16	読み取りセンサーの角度	      0x0132（306 度）
    
    UInt8は1バイト、UInt16は2バイト消費
    UInt8がひとつ、UInt16が６つで合計13バイト消費する
    =============================================
    */

    constructor(bluetoothController, storageController) {
        this.bluetoothController = bluetoothController;
        this.storageController = storageController;

        this.toioPosition = { x: 0, y: 0, angle: 0, sensorX: 0, sensorY: 0, sensorAngle: 0 };
        this.positionDisplayX = document.getElementById('dispX');
        this.positionDisplayY = document.getElementById('dispY');
        this.angleDisplay = document.getElementById('dispAngle');

        // メソッドのバインド
        this.PositionMissed = this.PositionMissed.bind(this);
        this.decodePositionDataContinuous = this.decodePositionDataContinuous.bind(this);
    }

    async startReadingPosition() {
        if (this.bluetoothController.devices.size > 0) {
            for (const [deviceId, deviceInfo] of this.bluetoothController.devices.entries()) {
                if (deviceInfo.characteristics && deviceInfo.characteristics.sensor) {
                    console.log("Reading sensor data from device:", deviceId);
                    try {
                        console.log('Starting Notifications...');
                        await deviceInfo.characteristics.sensor.startNotifications();
                        deviceInfo.characteristics.sensor.addEventListener('characteristicvaluechanged', this.decodePositionDataContinuous);
                        deviceInfo.characteristics.sensor.addEventListener('characteristicvaluechanged', this.PositionMissed);
                    } catch (error) {
                        console.log('Argh! Error reading sensor data:', error);
                    }
                } else {
                    console.log(`デバイスID:${deviceId}のSensor characteristicが見つかりません`);
                }
            }
        } else {
            // console.log('デバイスが接続されていません');
            window.modalController.show();
        }
    }

    async stopReadingPosition() {
        if (this.bluetoothController.devices.size > 0) {
            for (const [deviceId, deviceInfo] of this.bluetoothController.devices.entries()) {
                if (deviceInfo.characteristics && deviceInfo.characteristics.sensor) {
                    console.log("ReadingStop sensor data from device:", deviceId);
                    try {
                        console.log('Stop Notifications...');
                        await deviceInfo.characteristics.sensor.stopNotifications();
                        deviceInfo.characteristics.sensor.removeEventListener('characteristicvaluechanged', this.decodePositionDataContinuous);
                        deviceInfo.characteristics.sensor.removeEventListener('characteristicvaluechanged', this.PositionMissed);
                    } catch (error) {
                        console.log('Argh! Error readingStop sensor data:', error);
                    }
                } else {
                    console.log(`デバイスID:${deviceId}のSensor characteristicが見つかりません`);
                }
            }
        } else {
            // console.log('デバイスが接続されていません');
            window.modalController.show()
        }
    }

    async PositionMissed(event) {
        let value = event.target.value
        const dataView = new DataView(value.buffer);

        if (dataView.getUint8(0) === 0x03) {
            console.log('座標を取得できません');

            // DrawingControllerのに処理内容記述あり
            document.dispatchEvent(new CustomEvent('positionMissed', {
            }));
        }
    }

    async getPosition() {
        if (this.bluetoothController.devices.size > 0) {
            for (const [deviceId, deviceInfo] of this.bluetoothController.devices.entries()) {
                if (deviceInfo.characteristics && deviceInfo.characteristics.sensor) {
                    console.log("Reading sensor data from device:", deviceId);
                    try {
                        const value = await deviceInfo.characteristics.sensor.readValue();
                        this.decodePositionDataOnce(deviceId, deviceInfo.device.name, value);
                    } catch (error) {
                        console.log('Argh! Error reading sensor data:', error);
                    }
                } else {
                    console.log(`デバイスID:${deviceId}のSensor characteristicが見つかりません`);
                }
            }
        } else {
            console.log('デバイスが接続されていません');
        }
    }

    /*
    ２つの関数を統合したい
    */
    // このケースは startReadingPosition からのイベントで呼び出された場合
    decodePositionDataContinuous = (event) => {
        let value = event.target.value;
        let deviceName = event.target.service.device.name;
        let deviceId = event.target.service.device.id;
        const dataView = new DataView(value.buffer);

        // DataViewのバイト長をチェック
        if (dataView.byteLength >= 13) { // 必要な最小バイト数を確認 (x, y, angleがそれぞれ2バイト、最初の1バイト分のオフセットを含む)
            this.toioPosition.x = dataView.getUint16(1, true);
            this.toioPosition.y = dataView.getUint16(3, true);
            this.toioPosition.angle = dataView.getUint16(5, true);
            this.toioPosition.sensorX = dataView.getUint16(7, true);
            this.toioPosition.sensorY = dataView.getUint16(9, true);
            this.toioPosition.sensorAngle = dataView.getUint16(11, true);

            //toioの座標が更新されたらdrawメソッドを実行
            //drawingControllerクラスのregisterEventListeners()メソッドに定義
            const positionUpdatedEvent = new CustomEvent('positionUpdated', {
                detail: {
                    ...this.toioPosition,
                    deviceInfo: {
                        deviceName: deviceName,
                        deviceId: deviceId
                    }
                }
            });
            document.dispatchEvent(positionUpdatedEvent);

            this.positionDisplayX.textContent = this.toioPosition.x;
            this.positionDisplayY.textContent = this.toioPosition.y;
            this.angleDisplay.textContent = this.toioPosition.angle;

            // console.log(`
            // キューブの中心の X 座標値:${dataView.getUint16(1, true)}, 
            // キューブの中心の Y 座標値:${dataView.getUint16(3, true)}, 
            // Cubeの角度:${dataView.getUint16(5, true)}`
            // );
        } else {
            //  console.error('Received data is too short.');
        }
    }

    // このケースは getPosition からのデータで呼び出された場合
    decodePositionDataOnce = (deviceId, deviceName, sensor) => {
        const dataView = new DataView(sensor.buffer);

        if (dataView.byteLength >= 13) {
            this.toioPosition.x = dataView.getUint16(1, true);
            this.toioPosition.y = dataView.getUint16(3, true);
            this.toioPosition.angle = dataView.getUint16(5, true);
            this.toioPosition.sensorX = dataView.getUint16(7, true);
            this.toioPosition.sensorY = dataView.getUint16(9, true);
            this.toioPosition.sensorAngle = dataView.getUint16(11, true);

            //ローカルストレージに保存
            const positionData = {
                'daviceName': deviceName,
                'deviceID': deviceId,
                'x': this.toioPosition.x,
                'y': this.toioPosition.y,
                'angle': this.toioPosition.angle,
                'sensorX': this.toioPosition.sensorX,
                'sensorY': this.toioPosition.sensorY,
                'sensorAngle': this.toioPosition.sensorAngle
            }

            // デバイスID毎にローカルストレージからデータを取得し、存在しない場合は新しい配列を作成
            let deviceData = JSON.parse(this.storage.getItem(deviceName) || "[]");

            // データを追加
            deviceData.push(positionData);

            // ローカルストレージに保存
            this.storage.setItem(deviceName, JSON.stringify(deviceData));

            // console.log('キューブの中心の X 座標値:', dataView.getUint16(1, true));
            // console.log('キューブの中心の Y 座標値:', dataView.getUint16(3, true));
            // console.log('Cubeの角度:', dataView.getUint16(5, true));
        }

    }
}

/*
==============================
デフォルト設定値の定義
==============================
*/

//JSDoc
/**
 * @typedef {Object} MatBounds
 * @property {Object} topLeft - 左上座標
 * @property {number} topLeft.x - X座標
 * @property {number} topLeft.y - Y座標
 * @property {Object} bottomRight - 右下座標
 * @property {number} bottomRight.x - X座標
 * @property {number} bottomRight.y - Y座標
*/

/**
 * @typedef {Object} PositionReg
 * @property {number} x - X座標のオフセット
 * @property {number} y - Y座標のオフセット
*/

/**
 * @typedef {'sensor' | 'center'} CoordinateType
 * @description
 * - 'sensor': toioのセンサー位置の座標を使用
 * - 'center': toioキューブの中心位置の座標を使用
*/

/**
 * @typedef {Object} PhysicalDimensions
 * @property {number} width - 物理的な幅（mm）
 * @property {number} height - 物理的な高さ（mm）
*/

/**
 * @typedef {Object} DrawingConfig
 * @property {MatBounds} matBounds - toioマットの境界設定
 * @property {PositionReg} positionReg - 位置補正値
 * @property {CoordinateType} coordinateType - 使用する座標タイプ
 * @property {PhysicalDimensions} physicalDimensions - 物理的なサイズ設定
*/

const DEFAULT_CONFIG = {
    matBounds: {
        topLeft: { x: 90, y: 130 },
        bottomRight: { x: 410, y: 370 }
    },
    positionReg: { x: -90, y: -130 },
    coordinateType: 'sensor',
    physicalDimensions: {
        width: 420,  // A3の幅（mm）
        height: 297  // A3の高さ（mm）
    },
};

class DrawingController {
    /**
     * DrawingControllerのコンストラクタ
     * @param {DrawingConfig} config - 描画の設定オブジェクト
     * @param {StorageController} storageController - ストレージ管理
     * @param {PositionController} positionController - 位置情報管理
    */

    constructor(config = {}, storageController, positionController) {
        // 状態管理の初期化
        this.state = new DrawingState(this);

        // 依存オブジェクトの設定
        this.storageController = storageController;
        this.positionController = positionController;

        // 設定のマージ（デフォルト値と引数の値を合成）
        this.config = this.mergeConfig(DEFAULT_CONFIG, config);

        //Canvas要素の初期化
        this.initializeCanvasElements();
        //イベントリスナーの設定
        this.initializeEventListeners();
        //Canvas設定の初期化
        this.initializeCanvasSettings();

    }

    /**
     * 設定オブジェクトのマージ
     * @private
     * @param {DrawingConfig} defaultConfig - デフォルト設定
     * @param {Partial<DrawingConfig>} userConfig - ユーザー設定
     * @returns {DrawingConfig} マージされた設定
     */
    mergeConfig(defaultConfig, userConfig) {
        return {
            matBounds: {
                topLeft: {
                    x: userConfig.matBounds?.topLeft?.x ?? defaultConfig.matBounds.topLeft.x,
                    y: userConfig.matBounds?.topLeft?.y ?? defaultConfig.matBounds.topLeft.y
                },
                bottomRight: {
                    x: userConfig.matBounds?.bottomRight?.x ?? defaultConfig.matBounds.bottomRight.x,
                    y: userConfig.matBounds?.bottomRight?.y ?? defaultConfig.matBounds.bottomRight.y
                }
            },
            positionReg: {
                x: userConfig.positionReg?.x ?? defaultConfig.positionReg.x,
                y: userConfig.positionReg?.y ?? defaultConfig.positionReg.y
            },
            coordinateType: userConfig.coordinateType ?? defaultConfig.coordinateType,
            physicalDimensions: {
                width: userConfig.physicalDimensions?.width ?? defaultConfig.physicalDimensions.width,
                height: userConfig.physicalDimensions?.height ?? defaultConfig.physicalDimensions.height
            },
        };
    }

    initializeCanvasElements() {
        // Canvas要素の取得
        this.imageCanvas = document.getElementById('imageCanvas');
        this.drawCanvas = document.getElementById('drawCanvas');
        // コンテキストの取得
        this.imageCtx = this.imageCanvas.getContext('2d');
        this.drawCtx = this.drawCanvas.getContext('2d');
    }

    initializeEventListeners() {
        //描画処理イベントリスナー
        this.initializeDrawingControlListeners();
        // UI要素のイベントリスナー
        this.initializeUIEventListeners();
        // toioの位置更新イベントリスナー
        this.initializePositionEventListeners();
    }

    initializeDrawingControlListeners() {
        // 描画処理
        document.getElementById('startDrawingButton').addEventListener('click', this.handleDrawingStart.bind(this));
        document.getElementById('stopDrawingButton').addEventListener('click', this.handleDrawingStop.bind(this));
        document.getElementById('clearButton').addEventListener('click', this.requestCanvasClear.bind(this));
    }

    handleDrawingStart() {
        // console.log('お絵かき開始ボタンがクリックされました');
        this.positionController.startReadingPosition();
        this.state.setDrawingActive(true);
    }

    handleDrawingStop() {
        // console.log('お絵かき停止ボタンがクリックされました');
        this.positionController.stopReadingPosition();
        this.state.setDrawingActive(false);
    }

    requestCanvasClear() {
        // console.log('Canvasクリアボタンがクリックされました');
        this.state.CanvasClear();
    }

    initializeUIEventListeners() {
        const sizeSlider = document.getElementById('size-slider');
        const alphaSlider = document.getElementById('alpha-slider');
        const colorPicker = document.getElementById('pencilColor');

        // ペンの初期化
        document.getElementById('size').textContent = this.state.penSettings.lineWidth;
        sizeSlider.value = this.state.penSettings.lineWidth;
        document.getElementById('alpha').textContent = this.state.penSettings.alpha;
        alphaSlider.value = this.state.penSettings.alpha;

        // スライダーの変更イベント
        sizeSlider.addEventListener('input', (event) => {
            const value = event.target.value;
            this.state.updatePenSettings({ lineWidth: value });
            document.getElementById('size').textContent = value;
        });
        alphaSlider.addEventListener('input', (event) => {
            const value = event.target.value;
            this.state.updatePenSettings({ alpha: value });
            document.getElementById('alpha').textContent = value;
        });
        colorPicker.addEventListener('input', (event) => {
            const value = event.target.value;
            this.state.updatePenSettings({ color: value });
        });

        // モード切り替え
        document.querySelectorAll('input[name="drawMode"]').forEach(radio => {
            radio.addEventListener('change', (event) => {
                const mode = event.target.value === '1' ? 'pen' : 'eraser';
                this.state.updatePenSettings({ mode: mode });
            });
        });
    }

    initializePositionEventListeners() {
        //toioの位置更新イベント
        //decodePositionDataContinuousメソッドで発火
        document.addEventListener('positionUpdated', (event) => {
            if (this.state.flags.isDrawingActive) {
                const { deviceInfo, ...position } = event.detail;
                this.state.setDeviceInfo(deviceInfo.deviceName, deviceInfo.deviceId);
                this.state.updatePosition(position);
            }
        });

        //toioの位置取得失敗イベント
        //PositionContorollerのPositionMissedメソッドで発火
        document.addEventListener('positionMissed', (event) => {
            if (this.state.flags.isDrawingActive) {
                this.state.handleDrawFinish();
            }
        });
    }

    initializeStateChangeListener() {
        document.addEventListener('drawingStateChange', (event) => {
            const { type, data, deviceInfo } = event.detail;
            this.handleStateChange(type, data, deviceInfo);
        });
    }


    // Canvas設定の初期化メインメソッド
    initializeCanvasSettings() {
        this.calculateCoordinateSpaceDimensions();
        this.calculatePhysicalDimensions();
        this.calculateCanvasArea();
        this.initializeCanvasBufferSize();
        this.initializeCanvasDisplaySize();
        this.calculateScaleFactors();
        this.applyCanvasSettings();
    }

    calculateCoordinateSpaceDimensions() {
        // toioマットの座標範囲を計算
        this.toioCoordinateSpaceWidth = this.config.matBounds.bottomRight.x - this.config.matBounds.topLeft.x;
        this.toioCoordinateSpaceHeight = this.config.matBounds.bottomRight.y - this.config.matBounds.topLeft.y;
    }

    calculatePhysicalDimensions() {
        // 物理的なアスペクト比を計算
        this.matAspectRatio = this.config.physicalDimensions.width / this.config.physicalDimensions.height;
    }

    calculateCanvasArea() {
        const canvasArea = document.getElementById('canvas-area');
        const computedStyle = window.getComputedStyle(canvasArea);

        // marginとpaddingを除いた実際の利用可能なサイズを計算
        this.canvasAreaDimensions = {
            width: canvasArea.clientWidth -
                parseFloat(computedStyle.paddingLeft) -
                parseFloat(computedStyle.paddingRight),
            height: canvasArea.clientHeight -
                parseFloat(computedStyle.paddingTop) -
                parseFloat(computedStyle.paddingBottom)
        };
    }

    initializeCanvasBufferSize() {
        // 描画バッファーのデフォルトサイズを設定
        this.bufferDimensions = {
            width: 1920,
            height: 1080
        };

        // 現在のバッファーサイズを保持
        this.currentBufferSize = {
            width: this.bufferDimensions.width,
            height: this.bufferDimensions.height
        };
    }

    initializeCanvasDisplaySize() {
        // 利用可能な最大サイズを計算
        let displayWidth = this.canvasAreaDimensions.width;
        let displayHeight = displayWidth / this.matAspectRatio;

        // 高さが領域を超える場合は、高さに合わせて調整
        if (displayHeight > this.canvasAreaDimensions.height) {
            displayHeight = this.canvasAreaDimensions.height;
            displayWidth = displayHeight * this.matAspectRatio;
        }

        this.displayDimensions = {
            width: displayWidth,
            height: displayHeight
        };
    }

    calculateScaleFactors() {
        // toioの座標空間からCanvas座標空間への変換係数を計算
        this.scaleX = this.currentBufferSize.width / this.toioCoordinateSpaceWidth;
        this.scaleY = this.currentBufferSize.height / this.toioCoordinateSpaceHeight;
    }

    //Canvasサイズ適用
    applyCanvasSettings() {
        const canvases = [this.imageCanvas, this.drawCanvas];

        canvases.forEach(canvas => {
            // バッファーサイズの設定（実際の描画解像度）
            canvas.width = this.currentBufferSize.width;
            canvas.height = this.currentBufferSize.height;

            // CSS表示サイズの設定（画面上での見た目のサイズ）
            canvas.style.width = `${this.displayDimensions.width}px`;
            canvas.style.height = `${this.displayDimensions.height}px`;
            // marginを0に設定
            canvas.style.margin = '0';

            // コンテキストの設定
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // canvas-areaのスタイルも調整
            const canvasArea = document.getElementById('canvas-area');
            canvasArea.style.display = 'flex';
            canvasArea.style.justifyContent = 'center';
            canvasArea.style.alignItems = 'center';
        });
    }

    // Canvasを初期設定に戻す
    resetCanvasSize = () => {
        // バッファーサイズを初期値に戻す
        this.currentBufferSize = {
            width: this.bufferDimensions.width,
            height: this.bufferDimensions.height
        };

        this.applyCanvasSettings();
        this.calculateScaleFactors();
    }

    /*
    ==============================
    描画処理
    ==============================
    */

    // 状態変更ハンドラ
    handleStateChange(type, data, deviceInfo, timestamp) {
        // console.log(`State change: ${type} at ${new Date(timestamp).toISOString()}`);
        // console.log('Data:', data);

        switch (type) {
            case 'drawingActive':
                this.handleDrawingActiveChange(data);
                break;

            case 'position':
                this.handlePositionChange(data);
                break;

            case 'penSettings':
                this.handlePenSettingsChange(data, deviceInfo);
                break;

            case 'drawFinish':
                this.handleDrawFinishChange(data, deviceInfo);
                break;

            case 'clearCanvas':
                this.handleClearCanvas();
                break;
        }
    }

    handleDrawingActiveChange(isActive) {
        if (isActive) {
            this.positionController.startReadingPosition();
        } else {
            this.positionController.stopReadingPosition();
            if (this.state.position.current.x) {
                this.state.handleDrawFinish();
            }
        }
    }

    handlePositionChange(data) {
        const { previous, current, isEndOfLine } = data;

        if (!current.x || isEndOfLine) {
            return;
        }

        // 座標変換
        const currentCoords = this.convertCoordinates(current);

        // 初回描画時は現在の位置を開始点とする
        if (!previous.x) {
            return;
        }

        // 前回の座標も変換
        const previousCoords = this.convertCoordinates(previous);

        // 描画の実行
        this.performDraw(previousCoords, currentCoords);

        // 位置データの保存
        if (this.state.deviceInfo?.deviceName) {
            this.storageController.storePositionData(
                this.state.deviceInfo.deviceName,
                {
                    ...current,
                    isEndOfLine,
                    deviceId: this.state.deviceInfo.deviceId
                }
            );
        } else {
            console.log('デバイス名が設定されていません');
        }
    }

    convertCoordinates(position) {
        const coords = this.config.coordinateType === 'sensor'
            ? { x: position.sensorX, y: position.sensorY }
            : { x: position.x, y: position.y };

        //toio座標をCanvas座標に変換
        return {
            x: (coords.x + this.config.positionReg.x) * this.scaleX,
            y: (coords.y + this.config.positionReg.y) * this.scaleY
        }
    }

    caputurePixelData(coords) {
        const { toX, toY } = coords;

        if (this.imageCtx) {
            // imageCtxピクセルデータの取得
            const imageData = this.imageCtx.getImageData(toX, toY, 1, 1).data;
            // 履歴として保持
            this.state.addToHistory('imagePixelData', imageData);
            // console.log(`画像ピクセル (${toX}, ${toY}):`, imageData);
        }

        // drawCtxピクセルデータの取得
        const drawData = this.drawCtx.getImageData(toX, toY, 1, 1).data;
        // 履歴として保持
        this.state.addToHistory('drawPixelData', drawData);
        // console.log(`描画ピクセル (${toX}, ${toY}):`, drawData);
    }

    //描画実行処理
    performDraw(from, to) {
        // パスの設定
        this.drawCtx.beginPath();
        this.drawCtx.moveTo(from.x, from.y);
        this.drawCtx.lineTo(to.x, to.y);
        this.drawCtx.lineCap = 'round';

        // 描画の実行
        this.drawCtx.stroke();
    }

    handlePenSettingsChange(data) {
        const { current } = data;

        // 描画スタイルの更新
        this.drawCtx.lineWidth = current.lineWidth;
        if (current.mode === 'pen') {
            this.drawCtx.strokeStyle = current.color;
            this.drawCtx.globalAlpha = current.alpha;
        } else {
            this.drawCtx.strokeStyle = 'white';
            this.drawCtx.globalAlpha = 1;
        }

        // StorageControllerの更新
        this.storageController.updateDrawingState(
            current.mode,
            current.color,
            current.alpha,
            current.lineWidth
        );
    }

    handleDrawFinishChange(data) {
        const { previous, isEndOfLine } = data;
        console.log('isEndOfLine:', isEndOfLine);

        if (previous.x && isEndOfLine) {
            // パスを閉じる
            this.drawCtx.closePath();

            // StorageControllerに終了点をマーク
            if (this.state.deviceInfo.deviceName) {
                this.storageController.updateLastEntry(
                    this.state.deviceInfo.deviceName,
                    { isEndOfLine: true }
                );
            }
        }
    }

    // キャンバスクリア処理の実行
    handleClearCanvas() {
        this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    }
}

class DrawingState {
    constructor(drawingController) {
        this.drawingController = drawingController;

        // 描画フラグの状態
        this.flags = {
            isDrawingActive: false,
            isImageDrawn: false
        };

        // ペンの設定状態
        this.penSettings = {
            color: '#000000',
            alpha: 1,
            lineWidth: 3,
            mode: 'pen'
        };

        // 座標状態
        this.position = {
            current: {
                x: null,
                y: null,
                angle: null,
                sensorX: null,
                sensorY: null,
                sensorAngle: null
            },
            isEndOfLine: false
        };

        this.deviceInfo = {
            deviceName: null,
            deviceId: null
        };

        // ピクセルデータの履歴
        this.history = {
            imagePixelData: [],
            drawPixelData: []
        };

        this.notifyStateChange('initialized', this.getSnapshot());
    }

    setDeviceInfo(deviceName, deviceId) {
        this.deviceInfo = { deviceName, deviceId };
        this.notifyStateChange('deviceInfo', this.deviceInfo);
    }

    setDrawingActive(isActive) {
        this.flags.isDrawingActive = isActive;
        this.notifyStateChange('drawingActive', isActive);
    }

    setImageDrawn(isDrawn) {
        this.flags.isImageDrawn = isDrawn;
        this.notifyStateChange('imageDrawn', isDrawn);
    }

    updatePenSettings(settings) {
        const previousSettings = { ...this.penSettings };
        Object.assign(this.penSettings, settings);

        this.notifyStateChange('penSettings', {
            previous: previousSettings,
            current: this.penSettings
        });
    }

    updatePosition(positionData) {
        const previousPosition = { ...this.position.current };

        // 新しい位置データの更新
        if (positionData && positionData.x !== undefined) {
            this.position.current = {
                x: positionData.x,
                y: positionData.y,
                angle: positionData.angle,
                sensorX: positionData.sensorX,
                sensorY: positionData.sensorY,
                sensorAngle: positionData.sensorAngle
            };
            this.position.isEndOfLine = false;
        }

        this.notifyStateChange('position', {
            previous: previousPosition,
            current: this.position.current,
            isEndOfLine: this.position.isEndOfLine
        });
    }

    handleDrawFinish() {
        const previousPosition = { ...this.position.current };
        this.position.isEndOfLine = true;

        // 位置状態のリセット
        this.position.current = {
            x: null,
            y: null,
            angle: null,
            sensorX: null,
            sensorY: null,
            sensorAngle: null
        };

        this.notifyStateChange('drawFinish', {
            previous: previousPosition,
            current: this.position.current,
            isEndOfLine: true
        });
    }

    CanvasClear() {
        const previousState = this.getSnapshot();

        this.position = {
            current: {
                x: null,
                y: null,
                angle: null,
                sensorX: null,
                sensorY: null,
                sensorAngle: null
            },
            isEndOfLine: false
        };

        this.notifyStateChange('clearCanvas', {
            previous: previousState,
            current: this.getSnapshot()
        });
    }

    addToHistory(type, data) {
        this.history[type].push(Array.from(data));
        this.notifyStateChange('history', { type, data });
    }

    getSnapshot() {
        return {
            flags: { ...this.flags },
            penSettings: { ...this.penSettings },
            position: {
                current: { ...this.position.current },
                isEndOfLine: this.position.isEndOfLine
            },
            deviceInfo: { ...this.deviceInfo }
        };
    }

    notifyStateChange(type, data) {
        this.drawingController.handleStateChange(type, data, this.deviceInfo, Date.now());
    }
}

class ImageController {
    constructor(drawingController) {
        this.drawingController = drawingController;
        this.state = this.drawingController.state;

        this.uploadInput = document.getElementById('uploadfile');
        this.canvasArea = document.getElementById('canvas-area');
        this.imageCanvas = document.getElementById('imageCanvas');
        this.drawCanvas = document.getElementById('drawCanvas');
        this.imageCtx = imageCanvas.getContext('2d');
        this.drawCtx = drawCanvas.getContext('2d');

        this.initializeEventListeners();
    }

    initializeEventListeners() {
        this.uploadInput.addEventListener('change', this.handleImageUpload.bind(this));
        document.getElementById('removeImage').addEventListener('click', this.handleImageRemove.bind(this));
    }

    handleImageUpload(event) {
        const file = event.target.files[0];
        if (!this.validateImageFile(file)) return;

        const reader = new FileReader();
        reader.onload = (e) => this.handleFileRead(e);
        reader.readAsDataURL(file);
    }

    // ファイル検証
    validateImageFile(file) {
        if (!file) return false;

        if (file.type.indexOf("image") < 0) {
            alert("画像ファイルを指定してください。");
            return false;
        }
        return true;
    }

    //新しいImage要素を生成
    handleFileRead(event) {
        const img = new Image();
        img.onload = () => this.processImage(img);
        img.src = event.target.result;
    }

    //画像処理 親要素
    processImage(img) {
        // 現在のペン設定を保存
        const currentPenSettings = { ...this.state.penSettings };

        const dimensions = this.calculateDimensions(img);
        this.updateCanvasDimensions(dimensions);
        this.drawImage(img);

        // ペン設定を復元
        this.state.updatePenSettings(currentPenSettings);
        // 画像描画フラグを設定
        this.state.setImageDrawn(true);
    }

    //１．サイズ計算
    calculateDimensions(img) {
        const matAspectRatio = this.drawingController.matAspectRatio;

        // canvas-areaの利用可能なサイズを取得
        const computedStyle = window.getComputedStyle(this.canvasArea);
        const availableWidth = this.canvasArea.clientWidth -
            parseFloat(computedStyle.paddingLeft) -
            parseFloat(computedStyle.paddingRight);
        const availableHeight = this.canvasArea.clientHeight -
            parseFloat(computedStyle.paddingTop) -
            parseFloat(computedStyle.paddingBottom);

        // toioマットのアスペクト比を維持しながら最大サイズを計算
        let displayWidth = availableWidth;
        let displayHeight = displayWidth / matAspectRatio;

        // 高さが領域を超える場合は、高さに合わせて調整
        if (displayHeight > availableHeight) {
            displayHeight = availableHeight;
            displayWidth = displayHeight * matAspectRatio;
        }

        return {
            width: displayWidth,
            height: displayHeight
        };
    }

    //２．キャンバス更新
    updateCanvasDimensions(dimensions) {
        // DrawingControllerのCanvas設定メソッドを利用
        this.drawingController.displayDimensions = dimensions;
        this.drawingController.initializeCanvasSettings();

        // 描画キャンバスをクリア
        this.imageCtx.clearRect(0, 0, this.imageCanvas.width, this.imageCanvas.height);
        this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    }

    //３．画像の描画
    drawImage(img) {
        this.imageCtx.drawImage(
            img,
            0,
            0,
            this.imageCanvas.width,
            this.imageCanvas.height
        );
    }

    handleImageRemove() {
        // ファイル入力をリセット
        this.uploadInput.value = '';

        // 画像キャンバスをクリア
        this.imageCtx.clearRect(0, 0, this.imageCanvas.width, this.imageCanvas.height);

        // キャンバスサイズを初期設定に戻す
        this.drawingController.resetCanvasSize();

        // 描画キャンバスをクリアするが、ペン設定は維持
        const currentState = this.state.getSnapshot();  // 現在の状態を保存
        this.drawingController.handleClearCanvas();

        // ペン設定を復元
        this.state.updatePenSettings(currentState.penSettings);

        // 画像描画フラグをリセット
        this.state.setImageDrawn(false);
    }
}


class ReplayController {
    constructor(drawingController, storageController) {
        this.drawingController = drawingController;
        this.storageController = storageController;
        this.slider = document.getElementById('slider');
        this.replayInterval = null;
        this.isReplaying = false;
        this.storageData = [];

        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // スライダーのイベントリスナー
        this.slider.oninput = () => {
            if (!this.isReplaying) {
                this.drawPoints(parseInt(this.slider.value, 10));
            }
        };

        this.slider.onchange = () => {
            this.stopReplay();
            this.drawPoints(parseInt(this.slider.value, 10));
        };

        // リプレイ
        document.getElementById('replayDraw-start').addEventListener('click', () => {
            replayController.startReplay();
        });

        // リプレイ停止
        document.getElementById('replayDraw-stop').addEventListener('click', () => {
            replayController.stopReplay();
        });
    }

    drawStoragePoints = (deviceName) => {
        this.storageData = this.storageController.getData(deviceName);
        // console.log('Loaded replay data:', this.storageData);

        if (!this.storageData || this.storageData.length === 0) {
            console.warn('No replay data available for device:', deviceName);
            return;
        }

        // console.log('Loading replay data:', this.storageData.length, 'points');
        this.updateSlider(this.storageData.length);
        this.drawPoints(parseInt(this.slider.value, 10));
    }

    updateSlider = (length) => {
        this.stopReplay();
        this.slider.max = length - 1;
        this.slider.value = 0;
    }

    startReplay = () => {
        if (!this.storageData || this.storageData.length === 0) {
            console.warn('No data to replay');
            return;
        }

        let index = parseInt(this.slider.value, 10);
        this.isReplaying = true;

        this.drawingController.handleClearCanvas();

        clearInterval(this.replayInterval);
        this.replayInterval = setInterval(() => {
            if (index < this.storageData.length) {
                this.slider.value = index;
                this.drawPoints(index);
                index++;
            } else {
                clearInterval(this.replayInterval);
                this.isReplaying = false;
            }
        }, 50);
    }

    stopReplay = () => {
        clearInterval(this.replayInterval);
        this.isReplaying = false;
    }


    drawPoints = (index) => {
        this.drawingController.handleClearCanvas();

        for (let i = 0; i <= index; i++) {
            const currentData = this.storageData[i];
            if (!currentData) continue;

            if (i > 0 && !this.storageData[i - 1]?.metadata?.isEndOfLine) {
                const previousData = this.storageData[i - 1];
                this.ReplayDraw(previousData, currentData);
            }

            if (currentData.metadata?.isEndOfLine) {
                this.replayDrawFinish();
            }
        }
    }

    ReplayDraw = (fromPoint, toPoint) => {
        const fromCoords = this.drawingController.convertCoordinates({
            x: fromPoint.position.x,
            y: fromPoint.position.y,
            sensorX: fromPoint.position.sensorX,
            sensorY: fromPoint.position.sensorY
        });

        const toCoords = this.drawingController.convertCoordinates({
            x: toPoint.position.x,
            y: toPoint.position.y,
            sensorX: toPoint.position.sensorX,
            sensorY: toPoint.position.sensorY
        });

        const ctx = this.drawingController.drawCtx;
        ctx.beginPath();
        ctx.moveTo(fromCoords.x, fromCoords.y);
        ctx.lineTo(toCoords.x, toCoords.y);

        ctx.strokeStyle = toPoint.penSettings?.color || '#000000';
        ctx.globalAlpha = toPoint.penSettings?.alpha || 1;
        ctx.lineWidth = toPoint.penSettings?.lineWidth || 3;
        ctx.lineCap = 'round';


        ctx.stroke();
    }

    replayDrawFinish = () => {
        this.drawingController.drawCtx.closePath(); // 現在のパスを終了
        this.x = null;
        this.y = null;
    }

}

/**
 * ストレージのデータ構造を定義するスキーマ
 */
const STORAGE_SCHEMA = {
    // 位置情報
    position: {
        enabled: true,
        required: true,
        properties: ['x', 'y', 'angle', 'sensorX', 'sensorY', 'sensorAngle']
    },

    // ペン設定
    penSettings: {
        enabled: true,
        required: true,
        properties: ['mode', 'color', 'alpha', 'lineWidth']
    },

    // デバイス情報
    deviceInfo: {
        enabled: true,
        required: true,
        properties: ['deviceName', 'deviceId']
    },

    // メタデータ
    metadata: {
        enabled: true,
        required: true,
        properties: ['timestamp', 'sessionId', 'isEndOfLine', 'isClearedCanvas']
    }
};

class StorageController {
    constructor() {
        this.storage = localStorage;
        this.cache = new Map();

        // キャッシュ設定
        this.cacheConfig = {
            flushInterval: 5000,    // キャッシュフラッシュ間隔（ミリ秒）
            maxCacheSize: 1000      // デバイスごとの最大キャッシュエントリ数
        };

        this.currentDrawingState = {
            mode: 'pen',
            color: '#000000',
            alpha: 1,
            lineWidth: 3
        };

        this.sessionId = this.generateSessionId();
        this.initializeCacheFlush();
    }

    /**
     * セッションIDの生成
     */
    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * 位置データの保存
     */
    storePositionData(deviceName, data) {
        try {
            const formattedData = this.formatData(deviceName, data);

            this.addToCache(deviceName, formattedData);
            this.checkCacheSize(deviceName);

        } catch (error) {
            console.error('Data storage error:', error);
        }
    }

    formatData(deviceName, data) {
        return {
            position: {
                x: data.x,
                y: data.y,
                angle: data.angle,
                sensorX: data.sensorX,
                sensorY: data.sensorY,
                sensorAngle: data.sensorAngle
            },
            penSettings: { ...this.currentDrawingState },
            deviceInfo: {
                deviceName,
                deviceId: data.deviceId
            },
            metadata: {
                timestamp: Date.now(),
                sessionId: this.sessionId,
                isEndOfLine: data.isEndOfLine || false,
                isClearedCanvas: data.isClearedCanvas || false
            }
        };
    }

    updateDrawingState(mode, color, alpha, lineWidth) {
        this.currentDrawingState = {
            mode,
            color,
            alpha,
            lineWidth,
        };
    }

    recordCanvasClear() {
        const clearEvent = {
            type: 'clear',
            timestamp: Date.now(),
            sessionId: this.sessionId
        };
    }

    // =================== キャッシュ管理 ===================

    /**
     * キャッシュへのデータ追加
     */
    addToCache(deviceName, data) {
        if (!this.cache.has(deviceName)) {
            this.cache.set(deviceName, []);
        }
        this.cache.get(deviceName).push(data);
    }

    /**
     * キャッシュサイズの確認
     */
    checkCacheSize(deviceName) {
        const deviceCache = this.cache.get(deviceName);
        if (deviceCache?.length >= this.cacheConfig.maxCacheSize) {
            this.flushCache(deviceName);
        }
    }

    /**
     * キャッシュのフラッシュ処理
     */
    flushCache(deviceName) {
        const cachedData = this.cache.get(deviceName);
        if (cachedData?.length > 0) {
            const storedData = this.getStoredData(deviceName);
            const mergedData = [...storedData, ...cachedData];
            this.saveData(deviceName, mergedData);
            this.cache.set(deviceName, []);
        }
    }

    /**
     * 定期的なキャッシュフラッシュの初期化
     */
    initializeCacheFlush() {
        setInterval(() => {
            for (const deviceName of this.cache.keys()) {
                this.flushCache(deviceName);
            }
        }, this.cacheConfig.flushInterval);
    }

    // =================== データアクセス ===================

    /**
     * データの取得（キャッシュ + ストレージ）
     */
    getData(deviceName) {
        const cachedData = this.cache.get(deviceName) || [];
        const storedData = this.getStoredData(deviceName);
        return [...storedData, ...cachedData];
    }

    /**
     * ストレージからのデータ取得
     */
    getStoredData(deviceName) {
        try {
            const data = this.storage.getItem(deviceName);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('Storage read error:', error);
            return [];
        }
    }

    /**
     * データの永続化
     */
    saveData(deviceName, data) {
        try {
            this.storage.setItem(deviceName, JSON.stringify(data));
        } catch (error) {
            this.handleStorageError(error);
        }
    }

    /**
     * 最後のエントリの更新
     */
    updateLastEntry(deviceName, updateData) {
        // キャッシュデータの更新
        const cachedData = this.cache.get(deviceName);
        if (cachedData?.length > 0) {
            const lastEntry = cachedData[cachedData.length - 1];
            lastEntry.metadata.isEndOfLine = Boolean(updateData.isEndOfLine);
            return;
        }

        // ストレージデータの更新
        const storedData = this.getStoredData(deviceName);
        if (storedData.length > 0) {
            const lastEntry = storedData[storedData.length - 1];
            lastEntry.metadata.isEndOfLine = Boolean(updateData.isEndOfLine);
            this.saveData(deviceName, storedData);
        }
    }

    // =================== エラー処理 ===================

    /**
     * ストレージエラーの処理
     */
    handleStorageError(error) {
        if (error.name === 'QuotaExceededError') {
            console.warn('Storage quota exceeded. Cleaning up old data...');
            this.cleanupOldData();
        } else {
            console.error('Storage error:', error);
        }
    }

    /**
     * 古いデータのクリーンアップ
     */
    cleanupOldData() {
        for (const key of Object.keys(this.storage)) {
            const data = this.getStoredData(key);
            if (data.length > this.cacheConfig.maxCacheSize) {
                this.saveData(key, data.slice(-this.cacheConfig.maxCacheSize));
            }
        }
    }

    // =================== UI関連の機能 ===================

    displayLocalStorageKeys(replayController, canvasToToio) {
        const localStorageKeys = Object.keys(this.storage);
        const ulElement = document.getElementById('localStorageKeys');
        ulElement.innerHTML = ''; // Clear existing content

        localStorageKeys.forEach(key => {
            // li要素
            const liElement = document.createElement('li');

            // div要素
            const outerDivElement = document.createElement('div');
            outerDivElement.className = 'key-item row btn-group btn-group-sm';

            // div-span要素
            const spanDivElement = document.createElement('div');
            spanDivElement.className = 'key-item-span col-6 text-center';
            // キー名を表示するspan要素
            const keySpan = document.createElement('h5');
            keySpan.textContent = key;
            keySpan.className = 'key-name';
            spanDivElement.appendChild(keySpan);

            // div-button要素
            const buttonDivElement = document.createElement('div');
            buttonDivElement.className = 'key-item-button col-6 text-center';
            // 編集ボタン
            const editButton = document.createElement('button');
            editButton.textContent = '編集';
            editButton.setAttribute('type', 'button');
            editButton.className = 'btn btn-secondary';
            editButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this.editKey(key, keySpan)
            });
            buttonDivElement.appendChild(editButton);

            // 削除ボタン
            const deleteButton = document.createElement('button');
            deleteButton.textContent = '削除';
            deleteButton.setAttribute('type', 'button');
            deleteButton.className = 'btn btn-danger';
            deleteButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this.deleteKey(key, liElement)
            });
            buttonDivElement.appendChild(deleteButton);

            outerDivElement.appendChild(spanDivElement);
            outerDivElement.appendChild(buttonDivElement);

            liElement.appendChild(outerDivElement);

            outerDivElement.addEventListener('click', (event) => {
                if (event.target === liElement || event.target === keySpan) {
                    // 他の全ての要素から 'selected' クラスを削除
                    ulElement.querySelectorAll('li').forEach(li => li.classList.remove('selected'));
                    // クリックされた要素に 'selected' クラスを追加
                    liElement.classList.add('selected');
                    this.handleKeyClick(event, key, replayController, canvasToToio);
                }
            });

            const detailsElement = document.createElement('div');
            detailsElement.className = 'details';
            detailsElement.style.display = 'none';
            detailsElement.textContent = `${key}: ${this.storage.getItem(key)}`;

            ulElement.appendChild(liElement);
            ulElement.appendChild(detailsElement);
        });
    }

    editKey(oldKey, keySpan) {
        const newKey = prompt('新しいキー名を入力してください:', oldKey);
        if (newKey && newKey !== oldKey) {
            const value = this.storage.getItem(oldKey);
            this.storage.setItem(newKey, value);
            this.storage.removeItem(oldKey);
            keySpan.textContent = newKey;
            this.displayLocalStorageKeys(); // リストを更新
        }
    }

    deleteKey(key, liElement) {
        if (confirm(`"${key}"を削除してもよろしいですか？`)) {
            this.storage.removeItem(key);
            liElement.remove();
            this.displayLocalStorageKeys(); // リストを更新
        }
    }

    handleKeyClick(event, key, replayController) {
        if (replayController) {
            // 前回の描画をクリア
            replayController.drawingController.handleClearCanvas();
            // スライダーをリセット
            replayController.slider.value = 0;
            // 新しいデータを描画
            replayController.drawStoragePoints(key);
        } else {
            console.error('ReplayController is not defined');
        }

        if (canvasToToio) {
            canvasToToio.getStorageData(key);
        } else {
            console.error('CanvasToToio is not defined');
        }
    }

    toggleDetails(event) {
        const detailsElement = event.currentTarget.nextElementSibling;
        if (detailsElement.style.display === 'none' || !detailsElement.style.display) {
            detailsElement.style.display = 'block';
        } else {
            detailsElement.style.display = 'none';
        }
    }


}

class ScoringSystem {
    constructor() {
        this.imageCanvas = document.getElementById('imageCanvas');
        this.drawCanvas = document.getElementById('drawCanvas');

        this.imageCtx = this.imageCanvas.getContext('2d');
        this.drawCtx = this.drawCanvas.getContext('2d');

    }

    /*
    calculateSimilarity(userData, modelImageData, targetColor, tolerance) {
        let matchCount = 0;
        let modelColorCount = 0;
        let userDrawnPixelCount = 0;

        for (let i = 0; i < modelImageData.data.length; i += 4) {
            const userR = userData.data[i];
            const userG = userData.data[i + 1];
            const userB = userData.data[i + 2];
            const modelR = modelImageData.data[i];
            const modelG = modelImageData.data[i + 1];
            const modelB = modelImageData.data[i + 2];

            if (Math.abs(modelR - targetColor.r) <= tolerance &&
                Math.abs(modelG - targetColor.g) <= tolerance &&
                Math.abs(modelB - targetColor.b) <= tolerance) {
                if (Math.abs(userR - modelR) <= tolerance &&
                    Math.abs(userG - modelG) <= tolerance &&
                    Math.abs(userB - modelB) <= tolerance) {
                    matchCount++;
                    // 一致している箇所を青でマーキング
                    userData.data[i] = 0;     // R
                    userData.data[i + 1] = 0;   // G
                    userData.data[i + 2] = 255;   // B
                    userData.data[i + 3] = 255; // A
                } else {
                    // 一致していない箇所を赤でマーキング
                    userData.data[i] = 255;     // R
                    userData.data[i + 1] = 0;   // G
                    userData.data[i + 2] = 0;   // B
                    userData.data[i + 3] = 255; // A
                }
            }
        }

        this.drawCtx.putImageData(userData, 0, 0); // マーキングされたイメージをキャンバスに描画
        const similarity = (matchCount / totalCount) * 100;
        return similarity.toFixed(2);
    }
    */


    // ユークリッド距離
    calculateSimilarity(userData, modelImageData, targetColor, tolerance) {
        let matchCount = 0;
        let modelColorCount = 0;
        let userDrawnPixelCount = 0;

        // ユーザーが描画したピクセル数をカウント
        /*
        ==================== 
        RGBAの透明度を表すAlpha値が0でないなら、ユーザーが描画した部分と特定
        Canvasのデフォルト状態は(R:0, G:0, B:0, A:0)
        ====================
        */
        for (let i = 0; i < userData.data.length; i += 4) {
            const userA = userData.data[i + 3];
            if (userA !== 0) {
                userDrawnPixelCount++;
            }
        }

        // drawCanvasのピクセルデータを基にループ
        for (let i = 0; i < userData.data.length; i += 4) {
            const userR = userData.data[i];
            const userG = userData.data[i + 1];
            const userB = userData.data[i + 2];
            const userA = userData.data[i + 3];

            // ユーザーが描画した部分を特定
            if (userA !== 0) {
                if (i < modelImageData.data.length) {
                    const modelR = modelImageData.data[i];
                    const modelG = modelImageData.data[i + 1];
                    const modelB = modelImageData.data[i + 2];

                    const colorDistanceModel = Math.sqrt(
                        Math.pow(modelR - targetColor.r, 2) +
                        Math.pow(modelG - targetColor.g, 2) +
                        Math.pow(modelB - targetColor.b, 2)
                    );

                    if (colorDistanceModel <= tolerance) {
                        modelColorCount++;

                        const colorDistanceUser = Math.sqrt(
                            Math.pow(userR - modelR, 2) +
                            Math.pow(userG - modelG, 2) +
                            Math.pow(userB - modelB, 2)
                        );

                        if (colorDistanceUser <= tolerance) {
                            matchCount++;
                            // 一致している箇所を青でマーキング
                            userData.data[i] = 0;
                            userData.data[i + 1] = 0;
                            userData.data[i + 2] = 255;
                            userData.data[i + 3] = 255;
                        }
                    } else {
                        // modelImageDataに対応するピクセルが一致していない場合
                        userData.data[i] = 255;
                        userData.data[i + 1] = 0;
                        userData.data[i + 2] = 0;
                        userData.data[i + 3] = 255;
                    }
                }
            }
        }

        // マーキング部分をキャンバスに描画
        this.drawCtx.putImageData(userData, 0, 0);
        const similarity = (matchCount / userDrawnPixelCount) * 100;
        console.log(`モデルピクセルトータル：${modelColorCount} `);
        console.log(`ユーザーピクセルトータル：${userDrawnPixelCount} `);
        console.log(`一致数：${matchCount} `);
        return similarity.toFixed(2);
    }

    computeSimilarity(targetColor, tolerance) {
        const userImageData = this.drawCtx.getImageData(0, 0, this.drawCanvas.width, this.drawCanvas.height);
        const modelImageData = this.imageCtx.getImageData(0, 0, this.imageCanvas.width, this.imageCanvas.height);
        const similarity = this.calculateSimilarity(userImageData, modelImageData, targetColor, tolerance);
        console.log(`一致度: ${similarity}% `);
        alert(`あなたの点数は${similarity}点です`);
    }
}

class CanvasToToio {
    constructor(bluetoothController, storageController, responseTypes) {
        // 依存オブジェクトの設定
        this.bluetoothController = bluetoothController;
        this.storageController = storageController;
        this.RESPONSE_TYPES = responseTypes;
        // 内部状態の初期化
        this.storageData = {};
        this.MAX_TARGETS_PER_COMMAND = 2;

        // 座標タイプの設定
        this.config = {
            coordinateType: 'sensor', // 'sensor' or 'center'
        };

        this.initializeEventListeners();
    }

    /*
    ==============================
    イベントと初期設定
    ==============================
    */
    initializeEventListeners() {
        // toioリプレイ開始
        document.getElementById('toio-replay-start').addEventListener('click', () => {
            console.log('toioリプレイ開始ボタンがクリックされました');
            canvasToToio.setCoordinateType('center');
            canvasToToio.startReplay();
        });
    }

    /*
  ==============================
  実行処理
  ==============================
  */
    startReplay = () => {
        this.moveToMultipleTargets();
    }

    // メイン処理
    async moveToMultipleTargets() {
        const targets = this.defineTargets();
        const chunks = this.splitTargets(targets);

        // 分割したチャンクをループ(toioに繰り返し送信)
        for (let i = 0; i < chunks.length; i = i + 20) {
            const isLast = i === chunks.length - 1;
            const encodedCommand = this.encodeTargetPoints(chunks[i], isLast);
            console.log(encodedCommand);

            try {
                await this.writeToToio(encodedCommand);
                await this.receiveResponse();
            } catch (error) {
                console.error("Error during movement:", error);
                break;
            }
        }
    }

    /*
    ==============================
    データ管理と座標処理
    ==============================
    */
    //StorageController.handleKeyClick()から呼び出される
    getStorageData(deviceName) {
        this.storageData = this.storageController.getData(deviceName);
        console.log('Loaded data:', this.storageData);
    }

    defineTargets() {
        const targets = [];

        for (const data of this.storageData) {
            if (!data.position) continue;

            // 座標の選択
            const coords = this.selectCoordinates(data.position);
            const isEndOfLine = data.metadata?.isEndOfLine || false;

            // 座標が有効な場合のみ追加
            if (coords.x != null && coords.y != null && coords.angle != null) {
                targets.push({
                    x: coords.x,
                    y: coords.y,
                    angle: coords.angle,
                    isEndOfLine: isEndOfLine
                });
            }
        }

        console.log(`Generated ${targets.length} targets using ${this.config.coordinateType} coordinates`);
        return targets;
    }

    // 座標の選択処理
    selectCoordinates(position) {
        console.log(position);
        if (this.config.coordinateType === 'sensor') {
            return {
                x: position.sensorX,
                y: position.sensorY,
                angle: position.sensorAngle
            };
        } else {
            return {
                x: position.x,
                y: position.y,
                angle: position.angle
            };
        }
    }

    /*
    ==============================
    座標データの分割
    ==============================
    */
    splitTargets(targets) {
        const chunks = [];
        for (let i = 0; i < targets.length; i += this.MAX_TARGETS_PER_COMMAND) {
            chunks.push(targets.slice(i, i + this.MAX_TARGETS_PER_COMMAND));
        }
        return chunks;
    }

    encodeTargetPoints(targets, isLast) {
        // 各地点はx, y, angleの3つの値を持つ
        // 基本的な制御情報(8バイト) + 各地点の情報(6バイト)
        const bufferSize = 8 + (targets.length * 6);
        const buffer = new ArrayBuffer(bufferSize);
        const dataView = new DataView(buffer);

        dataView.setUint8(0, 0x04);  // 制御の種類
        dataView.setUint8(1, 0x00);  // 制御識別値
        dataView.setUint8(2, 0x05);  // タイムアウト時間 (5秒)
        dataView.setUint8(3, 0x02);  // 移動タイプ
        dataView.setUint8(4, 0x50);  // モーターの最大速度指示値
        dataView.setUint8(5, 0x00);  // モーターの速度変化タイプ
        dataView.setUint8(6, 0x00);  // Reserved
        dataView.setUint8(7, isLast ? 0x00 : 0x01);  // 書き込み操作の追加設定

        // ターゲット座標の設定
        targets.forEach((target, index) => {
            const baseIndex = 8 + (index * 6);
            dataView.setUint16(baseIndex, target.x, true);
            dataView.setUint16(baseIndex + 2, target.y, true);
            dataView.setUint16(baseIndex + 4, target.angle, true);
        });
        return new Uint8Array(buffer);
    }

    async writeToToio(command) {
        try {
            await this.bluetoothController.sendToioCommand(command, 'motor');
        } catch (error) {
            console.error('Error sending motor command:', error);
            throw error;
        }
    }

    async receiveResponse() {
        try {
            const response = await this.bluetoothController.motorCharacteristicResponse([this.RESPONSE_TYPES.MULTIPLE_TARGET_MOTOR_CONTROL]);

            const decodeResponseType = {
                controlType: '0x' + response.controlType.toString(16).padStart(2, '0'),
                controlId: '0x' + response.controlId.toString(16).padStart(2, '0'),
                responseContent: '0x' + response.responseContent.toString(16).padStart(2, '0')
            }

            this.handleMotorResponse(decodeResponseType.responseContent);
            console.log('モーター制御応答:', decodeResponseType);

            // レスポンスデータが正常かどうか確認
            if (response.responseContent !== 0x00) {
                throw new Error(`Abnormal response: ${response.responseContent}`);
            }

            return response;
        } catch (error) {
            console.error('モーター制御応答の受信中にエラーが発生しました:', error);
            throw error;
        }
    }

    // 座標タイプの設定メソッド
    setCoordinateType(type) {
        if (type !== 'sensor' && type !== 'center') {
            throw new Error('Invalid coordinate type. Use "sensor" or "center".');
        }
        this.config.coordinateType = type;
        console.log(`Coordinate type set to: ${type}`);
    }

    // 座標タイプの取得メソッド
    getCoordinateType() {
        return this.config.coordinateType;
    }

    // toioの応答
    handleMotorResponse(response) {

        switch (response) {
            case '0x00':
                console.log('正常終了');
                break;
            case '0x01':
                console.log('タイムアウト');
                break;
            case '0x02':
                console.log('停止');
                break;
            case '0x03':
                console.log('目標位置に到達できず');
                break;
            case '0x04':
                console.log('不正なパラメーター');
                break;
            case '0x05':
                console.log('内部エラー');
                break;
            case '0x06':
                console.log('不正な目標指定');
                break;
            case '0x07':
                console.log('書き込み操作の追加不可');
                break;
        }
    }

}

class ModalController {
    constructor() {
        this.modal = new bootstrap.Modal(document.getElementById('alertModal'));
        this.modalTitle = document.getElementById('alertModalTitle');
        this.modalMessage = document.getElementById('alertModalMessage');

        // エラーメッセージの定義
        this.messages = {
            CONNECTION: 'デバイスが接続されていません。先にデバイスを接続してください。',
            DISCONNECTION: 'デバイスが接続されていないため、切断できません。'
        };
    }

    show(type = 'CONNECTION') {
        this.modalMessage.textContent = this.messages[type];
        this.modal.show();
    }

    hide() {
        this.modal.hide();
    }
}

/*
==============================
インスタンス
==============================
*/
const bluetoothController = new BluetoothController();
const storageController = new StorageController();
const positionController = new PositionController(bluetoothController, storageController);
const drawingController = new DrawingController(DEFAULT_CONFIG, storageController, positionController);
const imageController = new ImageController(drawingController);

document.addEventListener('DOMContentLoaded', () => {
    replayController = new ReplayController(drawingController, storageController);
    canvasToToio = new CanvasToToio(bluetoothController, storageController, BluetoothController.RESPONSE_TYPES);
    storageController.displayLocalStorageKeys(replayController, canvasToToio);
});
const scoringSystem = new ScoringSystem();
window.modalController = new ModalController();



/*
==============================
イベントリスナー
==============================
*/

// ローカルストレージデータ取得
document.addEventListener('DOMContentLoaded', () => {
    storageController.displayLocalStorageKeys(replayController);
});

// 採点
document.getElementById('calculate-similarity').addEventListener('click', () => {
    // 一致と判定するモデルの色
    const targetColor = { r: 74, g: 74, b: 74 };
    // 許容範囲
    const tolerance = 100;
    scoringSystem.computeSimilarity(targetColor, tolerance);
});

