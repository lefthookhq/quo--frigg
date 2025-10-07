const { OAuth2Requester, get } = require('@friggframework/core');
const FormData = require('form-data');

// core objects
// - https://developers.asana.com/reference/projects
// - https://developers.asana.com/reference/tags
// - https://developers.asana.com/reference/tasks
// - https://developers.asana.com/reference/users
// - https://developers.asana.com/reference/workspaces

class Api extends OAuth2Requester {
    constructor(params) {
        super(params);
        // The majority of the properties for OAuth are default loaded by OAuth2Requester.
        // This includes the `client_id`, `client_secret`, `scopes`, and `redirect_uri`.
        this.baseUrl = 'https://app.asana.com/api/1.0';

        this.URLs = {
            // User info
            userInfo: '/openid_connect/userinfo',

            // Projects
            projects: '/projects',
            projectById: (projectId) => `/projects/${projectId}`,

            // Tags
            tags: '/tags',
            tagById: (tagId) => `/tags/${tagId}`,

            // Tasks
            tasks: '/tasks',
            taskById: (taskId) => `/tasks/${taskId}`,

            // Users
            users: '/users',
            userById: (userId) => `/users/${userId}`,

            // Workspaces
            workspaces: '/workspaces',
            workspaceById: (workspaceId) => `/workspaces/${workspaceId}`,

            // Attachments
            attachments: '/attachments',
        };

        this.authorizationUri = encodeURI(
            `https://app.asana.com/-/oauth_authorize?response_type=code&client_id=${this.client_id}&redirect_uri=${this.redirect_uri}&state=${this.state}&scope=${this.scope}`
        );
        this.tokenUri = 'https://app.asana.com/-/oauth_token';

        this.access_token = get(params, 'access_token', null);
        this.refresh_token = get(params, 'refresh_token', null);
    }

    getAuthUri() {
        return this.authorizationUri;
    }

    async getTokenFromCode(code) {
        // The token request will fail if Bearer header is applied
        // Therefore,  there happens to be an access_token, remove it
        delete this.access_token;
        return super.getTokenFromCode(code);
    }

    async setTokens(params) {
        this.access_token = get(params, 'access_token');
        const newRefreshToken = get(params, 'refresh_token', null);

        // Asana provides only one long lived refresh token, so we don't need to replace it.
        if (newRefreshToken) {
            this.refresh_token = newRefreshToken;
        }

        const accessExpiresIn = get(params, 'expires_in', null);
        const refreshExpiresIn = get(params, 'x_refresh_token_expires_in', null);

        if (accessExpiresIn) {
            this.accessTokenExpire = new Date(Date.now() + accessExpiresIn * 1000);
        }
        if (refreshExpiresIn) {
            this.refreshTokenExpire = new Date(Date.now() + refreshExpiresIn * 1000);
        }

        await this.notify(this.DLGT_TOKEN_UPDATE);
    }


    addJsonHeaders(options) {
        const jsonHeaders = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
        options.headers = {
            ...jsonHeaders,
            ...options.headers,
        }
    }
    async _post(options, stringify) {
        this.addJsonHeaders(options);
        return super._post(options, stringify);
    }

    async _patch(options, stringify) {
        this.addJsonHeaders(options);
        return super._patch(options, stringify);
    }

    async _put(options, stringify) {
        this.addJsonHeaders(options);
        return super._put(options, stringify);
    }

    // **************************   User details  **********************************

    async getUserDetails() {
        const options = {
            url: this.baseUrl + this.URLs.userInfo,
        };

        return this._get(options);
    }

    // **************************   Projects   **********************************

    async createProject(body) {
        const options = {
            url: this.baseUrl + this.URLs.projects,
            body: {
                data: body,
            },
        };

        return this._post(options);
    }

    async listProjects(params) {
        const options = {
            url: this.baseUrl + this.URLs.projects,
            query: params
        };

        return this._get(options);
    }

    async updateProject(id, body) {
        const options = {
            url: this.baseUrl + this.URLs.projectById(id),
            body: {
                data: body,
            },
        };
        return this._put(options);
    }

    async deleteProject(id) {
        const options = {
            url: this.baseUrl + this.URLs.projectById(id),
        };

        return this._delete(options);
    }

    async getProjectById(id) {
        const options = {
            url: this.baseUrl + this.URLs.projectById(id),
        };

        return this._get(options);
    }

    // **************************   Tags   **********************************

    async createTag(body) {
        const options = {
            url: this.baseUrl + this.URLs.tags,
            body: {
                data: body,
            },
        };

        return this._post(options);
    }

    async listTags() {
        const options = {
            url: this.baseUrl + this.URLs.tags,
        };

        return this._get(options);
    }

    async updateTag(id, body) {
        const options = {
            url: this.baseUrl + this.URLs.tagById(id),
            body: {
                data: body,
            },
        };
        return this._put(options);
    }

    async deleteTag(id) {
        const options = {
            url: this.baseUrl + this.URLs.tagById(id),
        };
        return this._delete(options);
    }

    async getTagById(id) {
        const options = {
            url: this.baseUrl + this.URLs.tagById(id),
        };
        return this._get(options);
    }

    // **************************   Tasks   **********************************

    async createTask(body) {
        const options = {
            url: this.baseUrl + this.URLs.tasks,
            body: {
                data: body,
            },
        };

        return this._post(options);
    }

    async listTasks(params) {
        const workspaceId = get(params, 'workspaceId');
        const assigneeId = get(params, 'assigneeId');

        const options = {
            url: this.baseUrl + this.URLs.tasks,
            query: {
                workspace: workspaceId,
                assignee: assigneeId,
            }
        };

        return this._get(options);
    }

    async updateTask(id, body) {
        const options = {
            url: this.baseUrl + this.URLs.taskById(id),
            body: {
                data: body,
            },
        };
        return this._put(options);
    }

    async deleteTask(id) {
        const options = {
            url: this.baseUrl + this.URLs.taskById(id),
        };
        return this._delete(options);
    }

    async getTaskById(id) {
        const options = {
            url: this.baseUrl + this.URLs.taskById(id),
        };
        return this._get(options);
    }

    async attachToTask(taskId, resource, options = {}) {
        try {
            const formData = new FormData();
            formData.append('parent', taskId);

            if (typeof resource === 'string') {
                // Handle external URL attachment
                const fileName = resource.split('/').pop();
                formData.append('url', resource);
                formData.append('name', fileName);
                formData.append('connect_to_app', 'true');
                formData.append('resource_subtype', 'external');
            } else if (Buffer.isBuffer(resource) || resource instanceof Uint8Array) {
                // Handle file upload from buffer
                const fileName = options.fileName || 'attachment';
                formData.append('file', resource, {
                    filename: fileName,
                    contentType: options.contentType || 'application/octet-stream'
                });
            } else {
                throw new Error('Resource must be either a URL string or a Buffer/Uint8Array');
            }

            const requestOptions = {
                method: 'POST',
                url: this.baseUrl + this.URLs.attachments,
                body: formData,
                headers: {
                    'Authorization': `Bearer ${this.access_token}`
                }
            };

            let response = await super._post(requestOptions, false);

            if (!response?.data) {
                throw new Error('Failed to attach file to task: No response data received');
            }

            response = {
                ...response.data,
                resource_name: response.data.name,
                resource_url: typeof resource === 'string' ? resource : null,
            };

            return response;
        } catch (err) {
            console.log(err);
            throw err;
        }
    }

    async listAttachments(taskId) {
        const options = {
            url: this.baseUrl + this.URLs.attachments,
            query: {
                parent: taskId,
            },
        };
        return this._get(options);
    }

    async getAttachmentById(id) {
        const options = {
            url: `${this.baseUrl}${this.URLs.attachments}/${id}`,
        };
        return this._get(options);
    }

    // **************************   Users   **********************************

    async createUser(body) {
        const options = {
            url: this.baseUrl + this.URLs.users,
            body: {
                data: body,
            },
        };

        return this._post(options);
    }

    async listUsers() {
        const options = {
            url: this.baseUrl + this.URLs.users,
        };

        return this._get(options);
    }

    async updateUser(id, body) {
        const options = {
            url: this.baseUrl + this.URLs.userById(id),
            body: {
                data: body,
            },
        };
        return this._put(options);
    }

    async deleteUser(id) {
        const options = {
            url: this.baseUrl + this.URLs.userById(id),
        };
        return this._delete(options);
    }

    async getUserById(id) {
        const options = {
            url: this.baseUrl + this.URLs.userById(id),
        };
        return this._get(options);
    }

    // **************************   Workspaces   **********************************

    async listWorkspaces() {
        const options = {
            url: this.baseUrl + this.URLs.workspaces,
        };

        return this._get(options);
    }

    async getWorkspaceById(id) {
        const options = {
            url: this.baseUrl + this.URLs.workspaceById(id),
        };
        return this._get(options);
    }

    async updateWorkspace(id, body) {
        const options = {
            url: this.baseUrl + this.URLs.workspaceById(id),
            body: {
                data: body,
            },
        };
        return this._put(options);
    }

}

module.exports = { Api };
