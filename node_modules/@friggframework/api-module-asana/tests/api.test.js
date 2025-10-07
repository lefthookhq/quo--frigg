const {Api} = require('../api');
const config = require('../defaultConfig.json');
const {randomBytes} = require('crypto');

const apiParams = {
	client_id: process.env.ASANA_CLIENT_ID,
	client_secret: process.env.ASANA_CLIENT_SECRET,
	redirect_uri: `${process.env.REDIRECT_URI}/asana`,
	scope: process.env.ASANA_SCOPE
};
const api = new Api(apiParams);

const getRandomId = () => randomBytes(10).toString('hex');

describe(`${config.label} API tests`, () => {

		beforeEach(() => {
			jest.clearAllMocks();
		});

		// **************************   Constructor  **********************************

		describe('Constructor', () => {
			it('Should initialize with a proper authorizationUri', () => {
				const authUri = new URL(api.getAuthUri());
				expect(authUri).toHaveProperty('protocol', 'https:');
				expect(authUri).toHaveProperty('hostname', 'app.asana.com');
				expect(authUri.searchParams.get('client_id')).toBe(process.env.ASANA_CLIENT_ID);
				expect(authUri.searchParams.get('redirect_uri')).toBe(`${process.env.REDIRECT_URI}/asana`);
				expect(authUri.searchParams.get('response_type')).toBe('code');
				expect(authUri.searchParams.get('scope')).toBe(process.env.ASANA_SCOPE);
			});
		});

		// **************************   User details  **********************************

		describe('Get user details', () => {
			it('Should call _get with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._get = jest.fn().mockResolvedValue(mockResponse);
				const response = await api.getUserDetails();
				expect(api._get).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.userInfo}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		// **************************   Projects  **********************************

		describe('List projects', () => {
			it('Should call _get with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._get = jest.fn().mockResolvedValue(mockResponse);
				const response = await api.listProjects();
				expect(api._get).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.projects}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Get project by id', () => {
			it('Should call _get with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._get = jest.fn().mockResolvedValue(mockResponse);
				const projectId = getRandomId();
				const response = await api.getProjectById(projectId);
				expect(api._get).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.projectById(projectId)}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Create project', () => {
			it('Should call _post with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._post = jest.fn().mockResolvedValue(mockResponse);
				const body = {name: 'Project name'};
				const response = await api.createProject(body);
				expect(api._post).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.projects}`,
					body: {data: body}
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Update project', () => {
			it('Should call _put with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._put = jest.fn().mockResolvedValue(mockResponse);
				const projectId = getRandomId();
				const body = {name: 'Project name'};
				const response = await api.updateProject(projectId, body);
				expect(api._put).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.projectById(projectId)}`,
					body: {data: body}
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Delete project', () => {
			it('Should call _delete with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._delete = jest.fn().mockResolvedValue(mockResponse);
				const projectId = getRandomId();
				const response = await api.deleteProject(projectId);
				expect(api._delete).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.projectById(projectId)}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		// **************************   Tags  **********************************

		describe('List tags', () => {
			it('Should call _get with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._get = jest.fn().mockResolvedValue(mockResponse);
				const response = await api.listTags();
				expect(api._get).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.tags}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Get tag by id', () => {
			it('Should call _get with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._get = jest.fn().mockResolvedValue(mockResponse);
				const tagId = getRandomId();
				const response = await api.getTagById(tagId);
				expect(api._get).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.tagById(tagId)}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Create tag', () => {
			it('Should call _post with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._post = jest.fn().mockResolvedValue(mockResponse);
				const body = {name: 'Tag name'};
				const response = await api.createTag(body);
				expect(api._post).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.tags}`,
					body: {data: body}
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Update tag', () => {
			it('Should call _put with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._put = jest.fn().mockResolvedValue(mockResponse);
				const tagId = getRandomId();
				const body = {name: 'Tag name'};
				const response = await api.updateTag(tagId, body);
				expect(api._put).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.tagById(tagId)}`,
					body: {data: body}
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Delete tag', () => {
			it('Should call _delete with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._delete = jest.fn().mockResolvedValue(mockResponse);
				const tagId = getRandomId();
				const response = await api.deleteTag(tagId);
				expect(api._delete).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.tagById(tagId)}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		// **************************   Tasks  **********************************

    describe('List tasks', () => {
        it('Should throw if invalid params are provided', async () => {
            api._get = jest.fn().mockResolvedValue(getRandomId());
            expect(api.listTasks()).rejects.toThrow();
            expect(api.listTasks({})).rejects.toThrow();
            expect(api.listTasks({workspaceId: '123'})).rejects.toThrow();
            expect(api.listTasks({workspaceId: '123', assigneeId: undefined})).rejects.toThrow();
        });

				it('Should call _get with the proper URL', async () => {
					const mockResponse = getRandomId();
					api._get = jest.fn().mockResolvedValue(mockResponse);
					const params = {workspaceId: '123', assigneeId: '456'}
					const response = await api.listTasks(params);
					expect(api._get).toHaveBeenCalledWith({
						url: `${api.baseUrl}${api.URLs.tasks}`,
						query: {assignee:params.assigneeId, workspace: params.workspaceId}
					});
					expect(response).toEqual(mockResponse);
				});
    });

		describe('Get task by id', () => {
			it('Should call _get with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._get = jest.fn().mockResolvedValue(mockResponse);
				const taskId = getRandomId();
				const response = await api.getTaskById(taskId);
				expect(api._get).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.taskById(taskId)}`
				});
				expect(response).toEqual(mockResponse);

			});
		});

		describe('Delete task', () => {
			it('Should call _delete with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._delete = jest.fn().mockResolvedValue(mockResponse);
				const taskId = getRandomId();
				const response = await api.deleteTask(taskId);
				expect(api._delete).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.taskById(taskId)}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Update task', () => {
			it('Should call _put with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._put = jest.fn().mockResolvedValue(mockResponse);
				const taskId = getRandomId();
				const body = {name: 'Task name'};
				const response = await api.updateTask(taskId, body);
				expect(api._put).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.taskById(taskId)}`,
					body: {data: body}
				});
				expect(response).toEqual(mockResponse);
			});
		});

		// **************************   Users  **********************************

		describe('Create user', () => {
			it('Should call _post with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._post = jest.fn().mockResolvedValue(mockResponse);
				const body = {name: 'User name'};
				const response = await api.createUser(body);
				expect(api._post).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.users}`,
					body: {data: body}
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('List users', () => {
			it('Should call _get with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._get = jest.fn().mockResolvedValue(mockResponse);
				const response = await api.listUsers();
				expect(api._get).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.users}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Get user by id', () => {
			it('Should call _get with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._get = jest.fn().mockResolvedValue(mockResponse);
				const userId = getRandomId();
				const response = await api.getUserById(userId);
				expect(api._get).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.userById(userId)}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Update user', () => {
			it('Should call _put with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._put = jest.fn().mockResolvedValue(mockResponse);
				const userId = getRandomId();
				const body = {name: 'User name'};
				const response = await api.updateUser(userId, body);
				expect(api._put).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.userById(userId)}`,
					body: {data: body}
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Delete user', () => {
			it('Should call _delete with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._delete = jest.fn().mockResolvedValue(mockResponse);
				const userId = getRandomId();
				const response = await api.deleteUser(userId);
				expect(api._delete).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.userById(userId)}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		// **************************   Workspaces  **********************************

		describe('List workspaces', () => {
			it('Should call _get with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._get = jest.fn().mockResolvedValue(mockResponse);
				const response = await api.listWorkspaces();
				expect(api._get).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.workspaces}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Get workspace by id', () => {
			it('Should call _get with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._get = jest.fn().mockResolvedValue(mockResponse);
				const workspaceId = getRandomId();
				const response = await api.getWorkspaceById(workspaceId);
				expect(api._get).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.workspaceById(workspaceId)}`
				});
				expect(response).toEqual(mockResponse);
			});
		});

		describe('Update workspace', () => {
			it('Should call _put with the proper URL', async () => {
				const mockResponse = getRandomId();
				api._put = jest.fn().mockResolvedValue(mockResponse);
				const workspaceId = getRandomId();
				const body = {name: 'Workspace name'};
				const response = await api.updateWorkspace(workspaceId, body);
				expect(api._put).toHaveBeenCalledWith({
					url: `${api.baseUrl}${api.URLs.workspaceById(workspaceId)}`,
					body: {data: body}
				});
				expect(response).toEqual(mockResponse);
			});
		});
});