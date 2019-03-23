let gl, program;
let pBuffer, cBuffer; // Our point and color buffers

let points = []; // The points from our input file
let colors = []; // The colors associated with each point
let lineColor = vec4(1.0, 1.0, 1.0, 1.0); // Make our lines white

/**
 * These objects help us keep track of the direction and offset to translate the mesh at each render
 *      When translating in negative direction: neg = 1, pos = 0, offset is adjusted at each render
 *      When translating in positive direction: neg = 0, pos = 1, offset is adjusted at each render
 */
let translateX = {"xNeg": 0, "xPos": 0, "offset": 0};
let translateY = {"yNeg": 0, "yPos": 0, "offset": 0};
let translateZ = {"zNeg": 0, "zPos": 0, "offset": 0};

let rollX = {"rolling": false, "theta": 0}; // When the mesh is rolling, increment theta at each render

let pulseFaces = {"pulsing": false, "pulsedPoints": [], "offset": 0}; // When pulsing, keep track of pulsed points and how much to move them

// These values help us center and scale our final model
let centerX = 0;
let centerY = 0;
let centerZ = 0;
let scaleFactor = 1;

function main() {

    // Setup the WebGL environment
    setupWebGL();

    // Try to render the scene - we wont see anything until a file is selected and parsed
    render();

    // Listen for file change
    let fileInput = document.getElementById("fileSelector");
    fileInput.addEventListener('change', function (e) {
        let reader = new FileReader();
        reader.readAsText(fileInput.files[0]);

        reader.onload = function (e) {
            // once we have the file, parse its data
            parseFile(reader.result);
        }
    });

    // Listen for key presses
    window.onkeydown = function (e) {
        handleKeyDown(e.key);
    }
}

/**
 * Setup our webgl enviornment
 */
function setupWebGL() {

    // Retrieve <canvas> element
    let canvas = document.getElementById('webgl');

    // Get the rendering context for WebGL
    gl = WebGLUtils.setupWebGL(canvas, undefined);
    if (!gl) {
        console.log('Failed to get the rendering context for WebGL');
        return;
    }

    // Initialize our shaders
    program = initShaders(gl, "vshader", "fshader");
    gl.useProgram(program);

    // Setup the viewport and clear colors
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    // Buffer for our points
    pBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pBuffer);

    // Enable our vertex positions
    let vPosition = gl.getAttribLocation(program, "vPosition");
    gl.vertexAttribPointer(vPosition, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vPosition);

    // Buffer for our colors
    cBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);

    // Enable our vertex colors
    let vColor = gl.getAttribLocation(program, "vColor");
    gl.vertexAttribPointer(vColor, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vColor);
}

/**
 * Render our mesh to the canvas, then request an animation frame
 */
function render() {

    // Setup our model view using the lookat() function
    let eye = vec3(0, 0, 2);
    let at = vec3(0, 0, 0);
    let up = vec3(0, 1, 0);
    let modelView = lookAt(eye, at, up);

    // Calculate the translate matrix
    let translateSpeed = 0.01;
    let matrixTranslated = translate(translateX.offset, translateY.offset, translateZ.offset);
    translateX.offset += translateSpeed * (translateX.xPos - translateX.xNeg);
    translateY.offset += translateSpeed * (translateY.yPos - translateY.yNeg);
    translateZ.offset += translateSpeed * (translateZ.zPos - translateZ.zNeg);

    // Calculate the rotate matrix
    let rotateSpeed = 1;
    let matrixRolledX = rotateX(rollX.theta);
    if (rollX.rolling) {
        rollX.theta += rotateSpeed;
    }

    // Setup our scale matrix based on the scale factor we set when parsing the file
    let matrixScaled = mat4(
        1 / scaleFactor, 0, 0, 0,
        0, 1 / scaleFactor, 0, 0,
        0, 0, 1 / scaleFactor, 0,
        0, 0, 0, 1
    );

    // Setup our center matrix based on the center values we set when parsing the file
    let matrixCentered = mat4(
        1, 0, 0, -centerX,
        0, 1, 0, -centerY,
        0, 0, 1, -centerZ,
        0, 0, 0, 1
    );

    // Translate, rotate, scale, and center our model
    let translated = mult(modelView, matrixTranslated);
    let rotated = mult(translated, matrixRolledX);
    let scaled = mult(rotated, matrixScaled);
    let final = mult(scaled, matrixCentered);

    // Clear the buffers
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Setup our model matrix
    let modelMatrix = gl.getUniformLocation(program, 'modelMatrix');
    gl.uniformMatrix4fv(modelMatrix, false, flatten(final));

    // Setup the perspective projection
    let projection = perspective(45, 1, 0.01, 200);
    let projectionMatrix = gl.getUniformLocation(program, 'projectionMatrix');
    gl.uniformMatrix4fv(projectionMatrix, false, flatten(projection));

    // Try to pulse the faces
    pulseFaces.pulsedPoints = [];
    pulseMeshFaces();

    // Push the new pulsed point data to our buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, pBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(pulseFaces.pulsedPoints), gl.STATIC_DRAW);

    // Push our color data to the buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(colors), gl.STATIC_DRAW);

    // Draw each face
    for (let i = 0; i < points.length - 2; i += 3) {
        gl.drawArrays(gl.LINE_LOOP, i, 3);
    }

    // Animate!
    requestAnimationFrame(render);
}

/**
 * Pulse the faces of our mesh. This function should be called even if the user has not turned pulse on, because it sets up
 * the points that will be drawn to our canvas. That is, if the mesh isn't pulsing, just push what we previously had to
 * the new array which will be drawn. This allows for a smooth transition between pulsing on and off.
 */
function pulseMeshFaces() {

    // Calculate the pulse offset
    if (pulseFaces.pulsing) {
        pulseFaces.offset += .1;
    }

    // Determine how much we need to pulse each face by
    let pulseDepth = 100; // the smaller the number, the further out the faces will pulse
    let pulseBy = -(Math.cos(pulseFaces.offset) - 1) * scaleFactor / pulseDepth;

    // Work through all the faces, apply the pulse translation/scale, and push those points to be drawn in our render function
    for (let i = 0; i < points.length - 2; i += 3) {
        let normal = normalize(newellMethod([points[i], points[i + 1], points[i + 2]])); // normalize our face
        let matrixScaled = vec3(normal[0] * pulseBy, normal[1] * pulseBy, normal[2] * pulseBy);
        let matrixTranslated = translate(matrixScaled);

        pulseFaces.pulsedPoints.push(mult(matrixTranslated, vec4(points[i][0], points[i][1], points[i][2], 1.0)));
        pulseFaces.pulsedPoints.push(mult(matrixTranslated, vec4(points[i + 1][0], points[i + 1][1], points[i + 1][2], 1.0)));
        pulseFaces.pulsedPoints.push(mult(matrixTranslated, vec4(points[i + 2][0], points[i + 2][1], points[i + 2][2], 1.0)));
    }
}

/**
 * Apply the newell method to the three points of a face to calculate the normal
 * @param facePoints The 3 points of our polygon representing the face
 * @returns {*}
 */
function newellMethod(facePoints) {

    let x = 0;
    let y = 0;
    let z = 0;

    // Apply the newell method
    facePoints.push(facePoints[0]);
    for (let i = 0; i < facePoints.length - 1; i++) {
        x += (facePoints[i][1] - facePoints[i + 1][1]) * (facePoints[i][2] + facePoints[i + 1][2]);
        y += (facePoints[i][2] - facePoints[i + 1][2]) * (facePoints[i][0] + facePoints[i + 1][0]);
        z += (facePoints[i][0] - facePoints[i + 1][0]) * (facePoints[i][1] + facePoints[i + 1][1]);
    }

    return vec3(x, y, z); // Return our normal
}

/**
 * This function parses the 'ply' file. In it, we determine how much the final model needs to be scaled and centered by
 * @param file The file from reader.result
 */
function parseFile(file) {

    // Keep track of the extents of our vertices
    let extents = {
        "xMin": 0, "xMax": 0,
        "yMin": 0, "yMax": 0,
        "zMin": 0, "zMax": 0,
    };

    points = [];
    let vertices = [];
    let numVertices = 0;
    let numPoints = 0;

    let fileLines = file.split("\n");

    let isHeaderFinished = false;

    // Process each line in the file
    for (let i = 0; i < fileLines.length; i++) {
        let currLine = fileLines[i].match(/\S+/g);

        if (!currLine) { // Skip blank lines
            continue;
        }

        if (!isHeaderFinished) { // Process header
            if (i === 0) { // We must have 'ply' on the first line
                if (currLine[0] === "ply") {
                    continue;
                } else {
                    alert("Error: 'ply' must be on the first line");
                    return;
                }
            } else if (currLine[0] === "element") { // Information about # of vertices and points
                if (currLine[1] === "vertex") {
                    numVertices = parseInt(currLine[2]);
                } else if (currLine[1] === "face") {
                    numPoints = parseInt(currLine[2]);
                }
            } else if (currLine[0] === "end_header") { // Done with the header, move on to vertices/points
                isHeaderFinished = true;
            }
        } else { // Done with header, now read info about vertices and points

            // Read vertices and calculate our extent bounds
            for (let j = 0; j < numVertices; j++, i++) {
                let currLine = fileLines[i].match(/\S+/g);

                let x = parseFloat(currLine[0]);
                let y = parseFloat(currLine[1]);
                let z = parseFloat(currLine[2]);
                vertices.push(vec4(x, y, z, 1.0));

                // check out extents bounds
                if (x < extents.xMin)
                    extents.xMin = x;
                if (x > extents.xMax)
                    extents.xMax = x;

                if (y < extents.yMin)
                    extents.yMin = y;
                if (y > extents.yMax)
                    extents.yMax = y;

                if (z < extents.zMin)
                    extents.zMin = z;
                if (z > extents.zMax)
                    extents.zMax = z;
            }

            // Read polygons, match them to respective vertices, and push to our points array
            // Also push our color values, since this will be the number of points we will eventually draw
            for (let j = 0; j < numPoints; j++, i++) {
                let currLine = fileLines[i].match(/\S+/g);

                points.push(vertices[parseInt(currLine[1])]);
                points.push(vertices[parseInt(currLine[2])]);
                points.push(vertices[parseInt(currLine[3])]);

                colors.push(lineColor);
                colors.push(lineColor);
                colors.push(lineColor);
            }
        }
    }

    // Calculate the scale factor
    let scaleX = (extents.xMax - extents.xMin);
    let scaleY = (extents.yMax - extents.yMin);
    let scaleZ = (extents.zMax - extents.zMin);
    scaleFactor = Math.max(scaleX, scaleY, scaleZ);

    // Calculate the center point in the x, y, and z direction
    centerX = (extents.xMax + extents.xMin) / 2;
    centerY = (extents.yMax + extents.yMin) / 2;
    centerZ = (extents.zMax + extents.zMin) / 2;
}

/**
 * This function handles what should happen when a key is pressed
 * @param key The key that was pressed
 */
function handleKeyDown(key) {

    key.toLowerCase();

    switch (key) {
        case 'x':
            translateX.xPos = !translateX.xPos;
            translateX.xNeg = 0;
            break;
        case 'c':
            translateX.xNeg = !translateX.xNeg;
            translateX.xPos = 0;
            break;
        case 'y':
            translateY.yPos = !translateY.yPos;
            translateY.yNeg = 0;
            break;
        case 'u':
            translateY.yNeg = !translateY.yNeg;
            translateY.yPos = 0;
            break;
        case 'z':
            translateZ.zPos = !translateZ.zPos;
            translateZ.zNeg = 0;
            break;
        case 'a':
            translateZ.zNeg = !translateZ.zNeg;
            translateZ.zPos = 0;
            break;
        case 'r':
            rollX.rolling = !rollX.rolling;
            break;
        case 'b':
            pulseFaces.pulsing = !pulseFaces.pulsing;
            break;
    }
}